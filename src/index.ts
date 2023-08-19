import { lua2js, l2jSystemFuncs, l2jGlobalVars, l2jInitedGlobalVars, lua2ast } from "@xiangnanscu/lua2js";
import { program } from "commander";
import fs from "fs-extra";
import * as path from "path";
import * as child_process from "child_process";

const PART_COUNT = 100;

function getFileExtension(file: string) {
    const basename = path.basename(file);
    const firstDot = basename.indexOf(".");
    const lastDot = basename.lastIndexOf(".");
    const extname = path.extname(basename).replace(/(\.[a-z0-9]+).*/i, "$1");

    if (firstDot === lastDot) {
        return extname;
    }

    return basename.slice(firstDot, lastDot) + extname;
}

function getFileBaseName(file: string) {
    return path.basename(file).replace(getFileExtension(file), "");
}

function outputOthers(allGlobalVars: Set<string>, initedGlobalVars: Set<string>, systemFuncs: Set<string>) {
    console.log(`---------------------`);
    console.log(`l2jGlobalVars: ${Array.from(allGlobalVars)}`);
    console.log(`---------------------`);
    console.log(`l2jInitedGlobalVars: ${Array.from(initedGlobalVars)}`);
    console.log(`---------------------`);
    console.log(`l2jSystemFuncs: ${Array.from(systemFuncs)}`);

    console.log(`---------------------`);
    let noInited = new Set<string>();
    allGlobalVars.forEach((v) => {
        if (!initedGlobalVars.has(v)) noInited.add(v);
    });
    console.log(`noInitedGlobalVars: ${Array.from(noInited)}`);
}

async function convertFile(source: string, dest: string, onlyExportGlobalVars: boolean = false) {
    // console.log(`source: ${source}, dest: ${dest}`);
    let luaCode = await fs.readFile(source, { encoding: "utf-8" });
    let output = "";
    if (onlyExportGlobalVars) {
        let vars = new Set<string>();
        let ast = lua2ast(luaCode);
        if (ast.globals?.length > 0) {
            for (let v of ast.globals) vars.add(v.name);
        }
        output = JSON.stringify(Array.from(vars));
    } else {
        output = lua2js(luaCode, source, false);
    }
    await fs.writeFile(dest, output, { encoding: "utf-8" });
}

const ENABLE_TEST = false;
function test() {
    let arr = new Array<any>();
    arr.push(`
    function test(t)
        local t = 1
        local t = 2
    end`);
    // arr.push(`a = {}`);
    // arr.push(`require('aaa)`)
    // arr.push(`function test()`);
    // arr.push(`local a = function()`);
    // arr.push(`G:init()`);
    // arr.push(`local b = string.bytes("abs")`);
    // arr.push(`end`);
    // arr.push(`end`);
    // arr.push(`-- test1`);
    // arr.push(`local M = {a=1}  -- test2`);
    // arr.push(`string.format("+%0.2f%%", add_value * 100)`);
    // arr.push(`-- test3 local m2 = {} `);
    // arr.push('local M = class("HeroBagControl", LikeOO.OOControlBase)');
    // arr.push("table.insert(M, 1)");
    // arr.push('table.insert(M, 2, "5")');
    // arr.push(`table.remove(M, 1)`);
    // arr.push('local s = string.format("t %d", 1)');
    // arr.push(`function M:init()`);
    // arr.push(`self.a = 1`);
    // arr.push(`end`);

    let luaCode = "";
    arr.forEach((v) => (luaCode += v + "\n"));
    let jsCode = lua2js(luaCode, "./temp/test.js", false);
    console.log(jsCode);
}

// https://stackoverflow.com/questions/5827612/node-js-fs-readdir-recursive-directory-search
export function walkParallel(dir: string, done: any) {
    let results = new Array<string>();
    fs.readdir(dir, (err: any, list: string[]) => {
        if (err !== null) return done(err);

        let pending = list.length;
        if (!pending) return done(null, results);
        list.forEach((inFile) => {
            let file = path.resolve(dir, inFile);
            fs.stat(file, (err: any, stat: any) => {
                if (stat?.isDirectory()) {
                    // eslint-disable-next-line max-nested-callbacks
                    walkParallel(file, (err: any, res: any) => {
                        results = results.concat(res);
                        if (!--pending) done(null, results);
                    });
                } else {
                    results.push(file);
                    if (!--pending) done(null, results);
                }
            });
        });
    });
}

export async function walkParallelPromise(dir: string) {
    return new Promise<string[]>((resolve, reject) => {
        walkParallel(dir, (err: any, list: string[]) => {
            if (err !== null) reject(err);
            else resolve(list);
        });
    });
}

async function convertSingle(source: string, newJsPath: string) {
    let dir = path.dirname(newJsPath);
    if (!(await fs.exists(dir))) {
        await fs.mkdir(dir, { recursive: true });
    }

    await convertFile(source, newJsPath);
}

async function convertDir(source: string, dest: string) {
    let files = await walkParallelPromise(source);

    if (!(await fs.exists(dest))) {
        await fs.mkdir(dest, { recursive: true });
    }

    let promises = new Array<any>();
    let all = new Array<any>();
    let allFilePath = new Array<string>();

    for (let file of files) {
        if (!file.endsWith(".lua")) continue;
        allFilePath.push(file);
    }

    let time = Date.now();
    let startTime = time;
    let processedCount = 0;
    for (let filePath of allFilePath) {
        let baseName = getFileBaseName(filePath);
        let relativePath = path.dirname(path.relative(source, filePath));
        let jsPath = path.join(dest, relativePath, baseName + ".js");

        promises.push(convertSingle(filePath, jsPath));
        if (promises.length >= PART_COUNT) {
            await Promise.all(promises);
            processedCount += PART_COUNT;
            promises = new Array<any>();
            let oldTime = time;
            time = Date.now();

            console.log(
                `convert percentage: ${((processedCount / allFilePath.length) * 100).toFixed(
                    2
                )}%, file count: ${processedCount}/${allFilePath.length}, time: ${(
                    (time - oldTime) /
                    1000
                ).toFixed()} s.`
            );
        }
        // break;
    }

    await Promise.all(promises);
    console.log(`convert done, total time: time: ${((Date.now() - startTime) / 1000).toFixed()} s.`);
}

async function convertDirWithMultiExec(source: string, dest: string) {
    let files = await walkParallelPromise(source);

    if (!(await fs.exists(dest))) {
        await fs.mkdir(dest, { recursive: true });
    }

    let tempFiles = new Array<string>();
    let fileList = new Map<string, number>();
    let index = 0;
    let totalFileCount = 0;
    const TEMP_FILE_PATH = path.join(process.cwd(), "temp");

    if (!(await fs.exists(TEMP_FILE_PATH))) {
        await fs.mkdir(TEMP_FILE_PATH, { recursive: true });
    }

    let writeData = async function () {
        let fileName = path.join(TEMP_FILE_PATH, `file_list_${++index}.txt`);
        await fs.writeFile(fileName, tempFiles.join("\n"));
        fileList.set(fileName, tempFiles.length);
    };

    for (let file of files) {
        if (!file.endsWith(".lua")) continue;

        ++totalFileCount;
        tempFiles.push(file);
        if (tempFiles.length >= PART_COUNT) {
            await writeData();
            tempFiles = new Array<string>();
        }
    }
    if (tempFiles.length > 0) {
        await writeData();
    }

    let systemFuncs = new Set<string>();
    let globalVars = new Set<string>();
    let initedGlobalVars = new Set<string>();
    let completedCount = 0;

    let testCount = 30;
    let startTime = Date.now();
    fileList.forEach((count, file) => {
        // if (--testCount < 0) return;

        child_process.exec(
            `node --expose-gc --max-old-space-size=8192 ./dist/index.js -s ${source} -d ${dest} -f ${file}`,
            (err, stdout, stderr) => {
                if (err) {
                    console.error(err || stderr);
                } else {
                    stdout.split("\n").forEach((line) => {
                        if (line.startsWith("l2jGlobalVars: ")) {
                            line.replace("l2jGlobalVars: ", "")
                                .split(",")
                                .forEach((v) => globalVars.add(v));
                        } else if (line.startsWith("l2jSystemFuncs: ")) {
                            line.replace("l2jSystemFuncs: ", "")
                                .split(",")
                                .forEach((v) => systemFuncs.add(v));
                        } else if (line.startsWith("l2jInitedGlobalVars: ")) {
                            line.replace("l2jInitedGlobalVars: ", "")
                                .split(",")
                                .forEach((v) => initedGlobalVars.add(v));
                        }
                    });

                    stderr = stderr?.trim();
                    if (stderr !== undefined && stderr.length > 0) console.warn(`stderr: ${stderr}`);
                    console.log(stdout);
                }

                (globalThis as any).gc();
                completedCount += count;
                console.log(
                    `convert percentage: ${((completedCount / totalFileCount) * 100).toFixed(
                        2
                    )}%, file count: ${completedCount}/${totalFileCount});`
                );

                if (completedCount >= totalFileCount) {
                    outputOthers(globalVars, initedGlobalVars, systemFuncs);
                    console.log(`convert done, total time: time: ${((Date.now() - startTime) / 1000).toFixed()} s.`);
                }
            }
        );
    });
}

async function convertWithFileList(filePath: string, source: string, dest: string) {
    let files = (await fs.readFile(filePath, "utf-8")).split("\n");
    let promises = new Array<any>();

    files.forEach((file) => {
        let baseName = getFileBaseName(file);
        let relativePath = path.dirname(path.relative(source, file));
        let jsPath = path.join(dest, relativePath, baseName + ".js");
        let ret = convertSingle(file, jsPath);
        promises.push(ret);
    });

    await Promise.all(promises);
}

async function replaceInFile(dest: string, filePath: string, from: any, to: any) {
    let fullPath = path.join(dest, filePath);
    let content = await fs.readFile(fullPath, "utf-8");
    content = content.replace(from, to);
    await fs.writeFile(fullPath, content);
}

async function main() {
    program
        .option("-s, --source <path>")
        .option("-d, --dest <path>")
        .option("--convert-dir")
        .option("-f, --file <path>", "convert a list of file")
        .option("-r, --post-replace <path:from:to>", "post replace file")
        .option("-g, --global-vars");
    program.parse();
    const options = program.opts();

    if (ENABLE_TEST) {
        test();
    } else {
        if (options.file) {
            await convertWithFileList(options.file, options.source, options.dest);
        } else if (options.convertDir) {
            return await convertDirWithMultiExec(path.resolve(options.source), options.dest);
        } else {
            await convertFile(options.source, options.dest, options.globalVars);
        }
    }

    if (options.postReplace) {
        let arr = options.postReplace.split(";");
        for (let v of arr) {
            let args = v.split("|");
            await replaceInFile(options.dest, args[0], new RegExp(args[1], "g"), args[2]);
        }
    }

    outputOthers(l2jGlobalVars, l2jInitedGlobalVars, l2jSystemFuncs);
}

await main();
