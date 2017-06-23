const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const pify = require('pify');

const mkdir = pify(fs.mkdir);
const readdir = pify(fs.readdir);

const inputFolder = path.join(__dirname, 'binaries');
const outputFolder = path.join(__dirname, 'zip');

async function compress() {
    try {
        await mkdir(outputFolder);
    } catch (e) {
        if (e.code !== 'EEXIST') {
            throw e;
        }
    }
    const architectures = await readdir(inputFolder);
    await Promise.all(architectures.map(arch => new Promise((resolve, reject) => {
        const archInputFolder = path.join(inputFolder, arch);
        const archOutputFile = path.join(outputFolder, `${arch}.zip`);
        console.log(`${archInputFolder} => ${archOutputFile}`);
        const output = fs.createWriteStream(archOutputFile);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Sets the compression level.
        });
        archive.on('error', reject);
        output.on('close', () => {
            console.log(`${archOutputFile}: ${archive.pointer()} bytes`);
            resolve();
        });
        archive.pipe(output);
        archive.directory(archInputFolder, false);
        archive.finalize();
        
    })));
}

compress().catch(error => {
    console.error(error.stack || `${error}`);
    process.exit(1);
});
