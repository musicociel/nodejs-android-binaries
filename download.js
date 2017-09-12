const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ar = require('ar');
const decompress = require('decompress');
const decompressTarxz = require('decompress-tarxz');
const requestPromise = require('request-promise-native');
const pify = require('pify');
const fsStat = pify(fs.access);
const readdir = pify(fs.readdir);
const readFile = pify(fs.readFile);
const writeFile = pify(fs.writeFile);

const lineRegExp = /^([^:]+):(.*)$/i
const parsePackagesList = function (packages) {
  const lines = packages.split('\n');
  const packagesMap = {};
  let curPackage = null;
  let lineNumber = 0;
  for (const line of lines) {
    lineNumber++;
    if (line) {
      if (!curPackage) {
        curPackage = {};
      }
      const match = lineRegExp.exec(line);
      if (match) {
        curPackage[match[1].toLowerCase()] = match[2].trim();
      } else {
        throw new Error(`Line ${lineNumber}, invalid line: ${line}`);
      }
    } else {
      if (curPackage) {
        const packageName = curPackage.package;
        if (!packageName) {
          throw new Error(`Line ${lineNumber - 1}, missing package name!`);
        } else if (packagesMap[packageName]) {
          throw new Error(`Line ${lineNumber - 1}, invalid or duplicate package: ${packageName}`);
        } else {
          packagesMap[packageName] = curPackage;
        }
        curPackage = null;
      }
    }
  }
  return packagesMap;
};

const buildDependenciesMap = function (packagesMap, packageName, map) {
  map = map || {};
  if (!map[packageName]) {
    const curPackage = packagesMap[packageName];
    if (!curPackage) {
      throw new Error(`Missing package: ${packageName}`);
    }
    map[packageName] = curPackage;
    let dependencies = curPackage.depends
    if (dependencies) {
      dependencies = dependencies.split(',');
      for (const dependency of dependencies) {
        buildDependenciesMap(packagesMap, dependency.trim(), map);
      }
    }
  }
  return map;
};

const downloadPackagesList = async function (url) {
  console.log(`Downloading ${url}...`);
  const fileContent = await requestPromise(url);
  return parsePackagesList(fileContent);
};

const downloadSinglePackage = async function (baseURL, packageInfo, outputFolder, extractOptions) {
  const url = `${baseURL}/${packageInfo.filename}`;
  console.log(`Downloading ${url}...`);
  const buffer = await requestPromise(url, {encoding: null});
  console.log(`Checking ${url}...`);
  if (buffer.length !== +packageInfo.size) {
    throw new Error(`Invalid file size: expected ${packageInfo.size}b but got ${buffer.length}b!`);
  }
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  const hashResult = hash.digest('hex');
  if (hashResult !== packageInfo.sha256) {
    throw new Error(`Invalid hash: expected ${packageInfo.sha256} but got ${hashResult}!`);
  }
  console.log(`Processing ${url}...`);
  const archive = new ar.Archive(buffer);
  for (const file of archive.getFiles()) {
    const fileName = file.name();
    if (fileName === 'data.tar.xz/') {
      await decompress(file.fileData(), outputFolder, Object.assign({
        plugins: [
          decompressTarxz()
        ]
      }, extractOptions));
    }
  }
};

const downloadPackageForMultipleArchs = async function (baseURL, archs, packageName, outputFolder, extractOptions) {
  const packagesMapAll = await downloadPackagesList(`${baseURL}/dists/stable/main/binary-all/Packages`);
  for (const arch of archs) {
    const packagesMapArch = await downloadPackagesList(`${baseURL}/dists/stable/main/binary-${arch.input}/Packages`);
    const mergedMap = Object.assign({}, packagesMapAll, packagesMapArch);
    const mapPackagesToDownload = buildDependenciesMap(mergedMap, packageName);
    const packagesToDownload = Object.keys(mapPackagesToDownload);
    for (const curPackage of packagesToDownload) {
      await downloadSinglePackage(baseURL, mapPackagesToDownload[curPackage], `${outputFolder}/${arch.output}`, extractOptions);
    }
  }
}

const downloadNodeJS = async function () {
  const sourceBaseURL = 'http://termux.net';
  const destFolder = path.join(__dirname, 'binaries');
  try {
    await fsStat(destFolder);
    console.log(`Skipping download from ${sourceBaseURL} as the destination folder already exists: ${destFolder}`);
    return;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
  }
  await downloadPackageForMultipleArchs(sourceBaseURL, [
    {
      input: 'aarch64',
      output: 'arm64-v8a'
    }, {
      input: 'arm',
      output: 'armeabi'
    }, {
      input: 'i686',
      output: 'x86'
    }, {
      input:'x86_64',
      output: 'x86_64'
    }
  ], 'nodejs-current', destFolder, {
    strip: 4,
    filter: (file) => {
      let res = true;
      const filePath = file.path;
      if (file.type !== 'file') {
        res = false;
      }
      const folder = path.dirname(filePath);
      if (folder !== 'usr/lib' && folder !== 'usr/bin') {
        res = false;
      }
      if (res) {
        file.path = path.basename(file.path);
        console.log(`- ${file.path}`);
      }
      return res;
    }
  });
};

const main = async function() {
  try {
    await downloadNodeJS();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
};

main();

