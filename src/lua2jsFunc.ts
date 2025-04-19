import prand from "pure-rand";
import * as luaStringSource from "@wowts/string";
import * as luaApiSource from "@wowts/lua";
import * as luaTableSource from "@wowts/table";
import * as luaBitSource from "@wowts/bit";
import * as luaMathSource from "@wowts/math";
// import * as pbjs from "protobufjs";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";

function copySource(source: any) {
    let ret = {};
    Object.assign(ret, source);
    return ret as any;
}

let luaTable = copySource(luaTableSource);
let luaString = copySource(luaStringSource);
let luaApi = copySource(luaApiSource);
let luaBit = copySource(luaBitSource);
let luaMath = copySource(luaMathSource);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const lua2jsUrl = pathToFileURL(path.resolve(__dirname, "../dist/lua2js.cjs")).href;

// const dateFormat = require("date-format");
// const sprintf = require("sprintf-js").sprintf;
// import * as dateFormat from "date-format";
const dateFormat = require("date-format");
// import * as sprintf from "sprintf-js";

let rng = prand.xoroshiro128plus(Math.random());
let l2j = {} as any;
let g = globalThis as any;
g.l2j = l2j;
let globalLib = {} as any;
const EMPTY_PARAM = Symbol();

// //////////////////////////////////////////////////////////////////////////////////////////////
function isCSObject(o: any) {
    // return o?.constructor !== undefined && puer.$typeof(o.constructor) !== undefined;
    return false;
}

function convertLuaTableToJsArray(t: any, convertedObjs = new Map<any, any>()) {
    if (t === undefined || t === null) return undefined;
    if (typeof t !== "object") return t;
    if (t.constructor?.name.indexOf("l2j") >= 0) return t;
    if (isCSObject(t)) return t;

    let found = convertedObjs.get(t);
    if (found !== undefined) return found;

    let kvs = Object.entries(t);
    let count = kvs.length;
    let isArray = kvs.find((v) => !Number.isSafeInteger(Number.parseInt(v[0]))) === undefined;
    if (isArray) {
        for (let i = count - 1; i >= 0; --i) {
            if (t[i] !== undefined) {
                count = i + 1;
                break;
            }
        }

        let ret = [] as any[];
        convertedObjs.set(t, ret);
        for (let i = 1; i <= count; i++) {
            ret.push(convertLuaTableToJsArray(t[i]));
        }
        return ret;
    } else {
        convertedObjs.set(t, t);
        for (let [k, v] of kvs) {
            t[k] = convertLuaTableToJsArray(v);
        }
        return t;
    }
}

function convertJsArrayToLuaTable(t: any, convertedObjs = new Map<any, any>(), stackCount = 0) {
    if (t === undefined || t === null) return undefined;
    if (typeof t !== "object") return t;
    if (t.constructor?.name.indexOf("l2j") >= 0) return t;
    if (isCSObject(t)) return t;

    let found = convertedObjs.get(t);
    if (found !== undefined) return found;

    if (stackCount > 20) {
        throw new Error("convertJsArrayToLuaTable stack overflow");
    }

    if (t instanceof Array) {
        let ret = {} as any;
        convertedObjs.set(t, ret);
        let count = t.length;
        for (let i = 0; i < count; ++i) {
            ret[i + 1] = convertJsArrayToLuaTable(t[i], convertedObjs, stackCount + 1);
        }
        return ret;
    } else {
        convertedObjs.set(t, t);
        for (let k in t) {
            t[k] = convertJsArrayToLuaTable(t[k], convertedObjs, stackCount + 1);
        }
        return t;
    }
}
l2j.convertJsArrayToLuaTable = convertJsArrayToLuaTable;

// //////////////////////////////////////////////////////////////////////////////////////////////
// table
l2j.table = luaTable;
l2j.table.insert_at = luaTable.insert;
// const WEAK_KEY = Symbol("table_weak_key");
// let arrayWeakMap = new WeakMap<any, any>();
const table_length = function (t: any) {
    if (t === undefined) return 0;
    if (typeof t === "string") return t.length;

    // let found = arrayWeakMap.get(WEAK_KEY);
    let values = Object.entries(t);
    let length = values.length;
    if (t[0] !== undefined) --length; // 去掉0
    while (length > 0 && values[length - 1][1] === undefined) {
        --length;
    }
    return length;
};
// l2j.table = {};
l2j.table.length = table_length;

l2j.table.insert = function (t: any, indexOrValue: any, value: any = EMPTY_PARAM) {
    const l = table_length(t);
    if (value !== EMPTY_PARAM && typeof indexOrValue === "number") {
        for (let i = l; i >= indexOrValue; i--) {
            t[i + 1] = t[i];
        }
        t[indexOrValue] = convertJsArrayToLuaTable(value);
    } else {
        t[l + 1] = convertJsArrayToLuaTable(indexOrValue);
    }
};

// l2j.table.insert = function (t: any, v: any) {
//     let length = table_length(t);
//     if (length === undefined) {
//         length = 1;
//     } else {
//         ++length;
//     }

//     t[length] = v;
//     arrayWeakMap.set(t, length);
// };

// l2j.table.insert_at = function (t: any, i: any, v: any) {
//     let length = table_length(t);
//     if (length === undefined) {
//         if (i === 1) {
//             t[1] = v;
//             arrayWeakMap.set(t, 1);
//         }
//     } else if (i <= length) {
//         for (let k = length + 1; k > i; --k) {
//             t[k] = t[k - 1];
//         }
//         t[i] = v;
//         arrayWeakMap.set(t, length + 1);
//     }
//     throw new Error("'insert' (position out of bounds)");
// };

// l2j.table.concat = function (t: any, v: any) {
//     let length = table_length(t);
//     if (length === undefined) {
//         if (v !== undefined) {
//             return v;
//         }
//     } else {
//         let ret = "";
//         for (let i = 1; i <= length; ++i) {
//             ret += t[i];
//         }
//         return ret + v ?? "";
//     }
//     return "";
// };

// l2j.table.remove = function (t: any, v: any) {
//     let length = table_length(t);
//     if (length === undefined) return;

//     for (let i = 1; i <= length; ++i) {
//         if (t[i] === v) {
//             for (let k = i; k < length; ++k) {
//                 t[k] = t[k + 1];
//             }
//             delete t[length];
//             arrayWeakMap.set(t, length - 1);
//             return;
//         }
//     }
// };

l2j.table.serialize = function (tdata: any) {
    let lookupTable = {} as any;
    function _dump(tb: any) {
        let str = "{";
        let keys = [];
        for (let [k, v] of Object.entries(tb)) {
            keys.push({ key: k, sort: String(k) });
        }
        keys.sort((a, b) => {
            return a.sort < b.sort ? -1 : 1;
        });
        for (let [i, key] of keys.entries()) {
            let k = key.key;
            let v = tb[k];
            str = str + ("[" + ((String(k) || typeof k) + ("]" + " = ")));
            if (typeof v === "object") {
                if (!(v in lookupTable)) {
                    lookupTable[v] = true;
                    str = str + _dump(v);
                } else {
                    str = str + (String(v) + ",\n");
                }
            } else {
                str = str + (String(v) + ",\n");
            }
        }
        str = str + "}\n";
        return str;
    }
    return _dump(tdata);
};

// l2j.table.sort = function (t: any, sortFunc: any) {
//     let arr = Object.entries(t);
//     arr.sort((a, b) => {
//         console.log(`a: ${a[1]}, b: ${b[1]}`);
//         return sortFunc(a[1], b[1]);
//     });
//     for (let i = 0; i < arr.length; i++) {
//         t[i + 1] = arr[i][1];
//     }
//     return t;
// };
// l2j.table.length = table_length;
l2j.table.unpack = luaApi.unpack;
// l2j.table.unpack = function (t: any) {
//     let arr = [] as any;
//     Object.entries(t).forEach((v) => arr.push(v[1]));
//     return arr;
// };

// //////////////////////////////////////////////////////////////////////////////////////////////
// string
l2j.string = luaString;
// l2j.string = {};
// l2j.string.upper = function (s: string) {
//     return s.toUpperCase();
// };

// l2j.string.sub = function (s: string, i: number, j: number) {
//     return s.substring(i - 1, j !== undefined ? j - 1 : undefined);
// };

// l2j.string.split = function (s: string, sep: string) {
//     return s.split(sep);
// };

// l2j.string.reverse = function (s: string) {
//     return s.split("").reverse().join("");
// };

l2j.string.rep = function (s: string, n: number) {
    return s.repeat(n);
};

// function convertLuaArrayToJS(luaArray: any) {
//     let count = luaArray.Length;
//     if (count === 0 || (count === 1 && luaArray[0] === undefined)) return;

//     let ret = [];
//     for (let i = 0; i < count; ++i) ret.push(luaArray[i]);
//     return ret;
// }

// const LUA_STRING_MATCH = CS.KTSLibrary.LuaStringMatch;
// l2j.string.match = function (s: string, pattern: string, init?: number) {
//     // return s.match(pattern);
//     // let luaRet = LUA_STRING_MATCH(s, pattern, init ?? 1);
//     // let ret = convertLuaArrayToJS(luaRet);
//     let ret = luaString.match(s, pattern);
//     return ret;
// };

// l2j.string.lower = function (s: string) {
//     return s.toLowerCase();
// };

// l2j.string.len = function (s: string) {
//     return s.length;
// };

// l2j.string.join = function (s: string, sep: string) {
//     return s + sep;
// };

// const LUA_STRING_GSUB = CS.KTSLibrary.LuaStringGSub;
// l2j.string.gsub = function (s: string, pattern: string, repl: any) {
//     //return s.replace(pattern, repl);
//     // let luaRet = LUA_STRING_GSUB(s, pattern, repl);
//     // let ret = convertLuaArrayToJS(luaRet);
//     let ret = luaString.gsub(s, pattern, repl);
//     return ret;
// };

// l2j.string.format = function (s: string, ...args: any[]) {
//     let ret = luaString.format(s, ...args);
//     return ret;
//     // return sprintf(s, ...args);
// };

let stringFind = luaString.find;
let findWithRet = function (s: string, pattern: string, init?: number) {
    let ret = stringFind(s, pattern, init);
    return ret;
};
l2j.string.findWithRet = findWithRet;

l2j.string.find = function (s: string, pattern: string, init?: number, plain?: boolean) {
    // let luaRet = LUA_STRING_FIND(s, pattern, init ?? 1, plain ?? false) as any;
    // let ret = convertLuaArrayToJS(luaRet);
    let ret = findWithRet(s, pattern, init);
    return ret.length > 0 ? ret : undefined;
};

// l2j.string.char = function (n: number) {
//     return String.fromCharCode(n - 1);
// };

// l2j.string.byte = function (s: string, i: number = 1) {
//     return s.charCodeAt(i - 1);
// };

l2j.string.split = function (s: string, sep: string) {
    let ret = s.split(sep);
    return convertJsArrayToLuaTable(ret);
};

l2j.string.ltrim = function (s: string) {
    return s.trimStart();
};

l2j.string.rtrim = function (s: string) {
    return s.trimEnd();
};

l2j.string.trim = function (s: string) {
    return s.trim();
};

l2j.string.judgeNumString = function (s: string) {
    return !Number.isNaN(Number(s));
};

let l2jString = l2j.string;
l2j.string = new Proxy(l2jString, {
    set: function (target, key, value) {
        if (key in l2jString) return true;
        target[key] = value;
        return true;
    },
});

// //////////////////////////////////////////////////////////////////////////////////////////////
// math
l2j.math = luaMath;
// l2j.math = {};
// l2j.math.abs = function (n: number) {
//     return Math.abs(n);
// };

// l2j.math.atan2 = function (y: number, x: number) {
//     return Math.atan2(y, x);
// };

// l2j.math.ceil = function (n: number) {
//     return Math.ceil(n);
// };

// l2j.math.cos = function (n: number) {
//     return Math.cos(n);
// };

// l2j.math.deg = function (n: number) {
//     return (n * 180) / Math.PI;
// };

// l2j.math.floor = function (n: number) {
//     return Math.floor(n);
// };

// l2j.math.log = function (n: number) {
//     return Math.log(n);
// };

// l2j.math.max = function (...args: number[]) {
//     return Math.max(...args);
// };

// l2j.math.min = function (...args: number[]) {
//     return Math.min(...args);
// };

l2j.math.sin = function (n: number) {
    return Math.sin(n);
};

l2j.math.sqrt = function (n: number) {
    return Math.sqrt(n);
};

l2j.math.sign = function (n: number) {
    return Math.sign(n);
};

l2j.math.clamp = function (n: number, min: number, max: number) {
    return Math.min(Math.max(n, min), max);
};

l2j.math.rad2Deg = function (n: number) {
    return (n * 180) / Math.PI;
};

l2j.math.modf = function (n: number) {
    return [Math.floor(n), n - Math.floor(n)];
};

// l2j.math.pow = function (x: number, y: number) {
//     return Math.pow(x, y);
// };

l2j.math.rad = function (n: number) {
    return (n * Math.PI) / 180;
};

l2j.math.random = function (min?: number, max?: number) {
    if (min === undefined) {
        let n = prand.unsafeUniformIntDistribution(0, 10000, rng);
        return 1 / n;
    } else if (max === undefined) {
        max = min;
        min = 1;
    }

    if (min > max) {
        let tmp = max;
        max = min;
        min = tmp;
    }
    return prand.unsafeUniformIntDistribution(min, max, rng);
};

l2j.math.randomseed = function (seed: number) {
    rng = prand.xoroshiro128plus(seed);
};

// l2j.math.round = function (n: number) {
//     return Math.round(n);
// };

// l2j.math.sin = function (n: number) {
//     return Math.sin(n);
// };

l2j.math.type = function (n: number) {
    return Number.isInteger(n) ? "integer" : "float";
};

// l2j.math.huge = Number.MAX_VALUE;
l2j.math.mininteger = Number.MIN_SAFE_INTEGER;
l2j.math.maxinteger = Number.MAX_SAFE_INTEGER;

// //////////////////////////////////////////////////////////////////////////////////////////////
// io
// 暂时禁了
let io = {} as any;
io.close = function () {
    throw new Error("io.close not supported");
};

io.lines = function (...args: any[]) {
    throw new Error("io.lines not supported");
};

io.open = function (filename: string, mode?: string) {
    throw new Error("io.open not supported");
};

const CHECK_PATH = "LuaScripts";
// function changeLuaToJsPath(path: string) {
//     let index = path.indexOf(CHECK_PATH);
//     if (index < 0 || !path.endsWith(".lua")) return path;

//     return (
//         CS.OldSystemLibrary.GetOldJSRootPath() + path.substring(index + CHECK_PATH.length + 1).replaceAll(".lua", ".js")
//     );
// }

l2j.io = io;
l2j.io = new Proxy(io, {
    set: function (target: any, property, value) {
        if (property == "writefile") {
            // 如果是写lua文件，这里转json下，方便js读取
            target[property] = function (path: string, content: string, mode: any) {
                let p = String(path);
                value(p, content, mode);

                if (p.endsWith(".lua")) {
                    console.error(`writefile ${p} to js`);
                    // let json = CS.OldSystemLibrary.ConvertLuaFileToJson(content);
                    // content = convertJsArrayToLuaTable(JSON.parse(json));
                    // let jsonFile = p.substring(0, path.length - 4) + ".json";
                    // value(jsonFile, JSON.stringify(content));
                }
            };
            return true;
        } else if (property === "readfile") {
            target[property] = function (path: string) {
                let filePath = path;
                if (filePath.endsWith(".lua")) {
                    filePath = path.substring(0, path.length - 4) + ".js";
                }
                return value(filePath);
            };
            return true;
        }

        target[property] = value;
        return true;
    },
});

// //////////////////////////////////////////////////////////////////////////////////////////////
// package
g.Package = {
    path: "",
    cpath: "",
    loaded: {},
};

// //////////////////////////////////////////////////////////////////////////////////////////////
// os
l2j.os = {};
l2j.os.time = function () {
    return Date.now();
};

l2j.os.exit = function () {
    throw new Error("os.exit");
};

l2j.os.date = function (format: string, time?: number) {
    return dateFormat(format, new Date(time ?? ""));
};

l2j.os.clock = function () {
    let time = new Date();
    return time.getTime() / 1000;
};

// //////////////////////////////////////////////////////////////////////////////////////////////
// debug
l2j.debug = {};
l2j.debug.traceback = function (message?: string, level?: number) {
    return new Error().stack;
};

l2j.debug.getinfo = function (func: Function, what?: string) {
    return new Error().stack;
};

l2j.debug.getlocal = function (func: Function, index: number) {
    throw new Error("debug.getlocal not supported");
};

l2j.debug.getregistry = function () {
    throw new Error("debug.getregistry not supported");
};

l2j.debug.getupvalue = function (func: Function, index: number) {
    throw new Error("debug.getupvalue not supported");
};

l2j.debug.sethook = function (func: Function, hook: Function, mask: string, count: number) {
    throw new Error("debug.sethook not supported");
};

l2j.debug.setupvalue = function (func: Function, index: number, value: any) {
    throw new Error("debug.setupvalue not supported");
};

l2j.debug.upvaluejoin = function (func1: Function, index1: number, func2: Function, index2: number) {
    throw new Error("debug.upvaluejoin not supported");
};

// //////////////////////////////////////////////////////////////////////////////////////////////
// operator
l2j.add = function (a: any, b: any) {
    if (typeof a === "string") return a + String(b);
    if (typeof a === "number" && typeof b === "number") return a + b;
    return a.__add(a, b);
};

l2j.sub = function (a: any, b: any) {
    if (typeof a !== "number") return a.__sub(a, b);
    else return a - b;
};

l2j.mul = function (a: any, b: any) {
    if (typeof a !== "number") return a.__mul(a, b);
    else return a * b;
};

l2j.div = function (a: any, b: any) {
    if (typeof a !== "number") return a.__div(a, b);
    else return a / b;
};

l2j.eq = function (a: any, b: any) {
    if (typeof a !== "number") return a.__eq(a, b);
    else return a === b;
};

l2j.neg = function (a: any) {
    if (typeof a !== "number") return a.__unm(a);
    else return -a;
};

l2j.and = function (a: any, b: any) {
    if (a === false || a === undefined) return a;
    else return b;
};

l2j.or = function (a: any, b: any) {
    if (a === false || a === undefined) return b;
    else return a;
};

l2j.condition = function (a: any) {
    return a !== false && a !== undefined;
};

// //////////////////////////////////////////////////////////////////////////////////////////////
// bit
g.bit = luaBit;
// TODO: 待验证
// g.bit = {};
globalLib.bit = g.bit;
// g.bit.band = function (a: any, b: any) {
//     return a & b;
// };

// g.bit.bor = function (a: any, b: any) {
//     return a | b;
// };

// g.bit.bxor = function (a: any, b: any) {
//     return a ^ b;
// };

// g.bit.bnot = function (a: any) {
//     return ~a;
// };

// g.bit.lshift = function (a: any, n: any) {
//     return a << n;
// };

// g.bit.rshif = function (a: any, n: any) {
//     return a >> n;
// };

// g.bit.arshift = function (a: any, n: any) {
//     return a >> n; // JavaScript 的带符号右移与 Lua 的 arshift 相似
// };

// g.bit.rol = function (a: any, n: any) {
//     return (a << n) | (a >>> (32 - n));
// };

// g.bit.ror = function (a: any, n: any) {
//     return (a >>> n) | (a << (32 - n));
// };

// //////////////////////////////////////////////////////////////////////////////////////////////
// pb
// let pb = {} as any;
// globalLib.pb = pb;
// let pbRoot = new pbjs.Root();
// pb.encode = function (name: string, msg: any) {
//     let tempMsg = convertLuaTableToJsArray(msg);
//     let type = pbRoot.lookupType(name);
//     if (!type) throw new Error("pb encode error: " + name);
//     let errMsg = type.verify(tempMsg);
//     if (errMsg) throw new Error("pb encode error: " + errMsg);
//     let buffer = type.encode(tempMsg).finish();
//     return buffer;
// };

// pb.decode = function (name: string, data: any) {
//     let type = pbRoot.lookupType(name);
//     if (!type) throw new Error("pb decode error: " + name);
//     let msg = type.decode(data);
//     let ret = convertJsArrayToLuaTable(msg);
//     return ret;
// };

// pb.load = function (path: any) {
//     let old = pbjs.util.fs;
//     pbjs.util.fs = {
//         readFileSync: function (path: string) {
//             return path.replaceAll("/", "//");
//         },
//     };
//     pbjs.loadSync(path, pbRoot);
//     pbjs.util.fs = old;
//     return true;
// };

// globalLib["Net/protoc"] = {
//     load: function (data: any) {
//         return pb.load(data);
//     },
// };

// //////////////////////////////////////////////////////////////////////////////////////////////
// other

const ORIGINAL_KEY = "__original";
const META_KEY = "__meta";
const PROXY_KEY = "__proxy";

g.rawset = function (t: any, k: any, v: any) {
    if (t.__original) t.__original[k] = v;
};
let rawset = g.rawset;

g.rawget = function (t: any, k: any) {
    let ret: any;
    if (ORIGINAL_KEY in t) ret = t.__original[k];
    return ret;
};
let rawget = g.rawget;

const metaTableProxy = {
    get: function (obj: any, property: string) {
        if (property === ORIGINAL_KEY) return obj.__original;
        if (property === META_KEY) return obj.__meta;

        let meta = obj.__meta;
        let ret: any;
        if (meta) {
            if ("__index" in meta) {
                let __index = meta.__index;
                if (typeof __index === `function`) ret = __index(obj, property);
                else ret = __index[property];
            } else {
                ret = meta[property];
            }
        }

        ret = ret ?? rawget(obj, property);
        if (typeof ret === "function")
            return function (...args: any[]) {
                return ret.apply(PROXY_KEY in obj ? obj[PROXY_KEY] : obj, args);
            };
        else return ret;
    },
    set: function (obj: any, property: string, value: any) {
        let meta = obj.__meta;
        if (meta && "__newindex" in meta) meta.__newindex.call(obj.__original, property, value);
        else rawset(obj, property, value);
        return true;
    },
};

function isClassInstance(obj: any) {
    return typeof obj === "object" && "constructor" in obj && obj.constructor.toString().startsWith("class ");
}

g.setmetatable = function (t: any, meta: any) {
    let obj = {};
    Object.defineProperty(obj, ORIGINAL_KEY, { value: t, enumerable: false });
    Object.defineProperty(obj, META_KEY, { value: meta, enumerable: false });
    let proxy = new Proxy(obj, metaTableProxy);
    Object.defineProperty(obj, PROXY_KEY, { value: proxy, enumerable: false });
    return proxy;
};

g.getmetatable = function (t: any) {
    return t[META_KEY];
};

// let proxyHandle = {
//     get: (obj: any, property: string) => {
//         return obj[property] ?? obj.constructor[property];
//     },
// };

// function newClassInstance(cls: any, ...args: any[]) {
//     let obj = new cls(...args);
//     let proxy = new Proxy(obj, proxyHandle);
//     Object.defineProperty(obj, PROXY_KEY, { value: proxy, enumerable: false });
//     return proxy;
// }

// function isProxy(obj: any) {
//     return typeof obj === "object" && PROXY_KEY in obj;
// }

let classIndex = 0;
l2j.createClass = function (arg: any, superClass?: any): any {
    let t = typeof arg;
    let name = (t === "string" ? arg : undefined) ?? `class_${classIndex++}`;
    let cls: any;

    let constructFunc = function (thisArg: any, callCtor: boolean, ...args: any[]) {
        // 非deepCopy
        if (typeof arg === "object") {
            for (let k in arg) thisArg[k] = arg[k];
        }
        if (callCtor && typeof thisArg.ctor === `function`) {
            thisArg.ctor.call(thisArg, ...args);
        }
    };

    if (superClass === undefined) {
        cls = class l2jBaseClass {
            public constructor(callCtor: boolean, ...args: any[]) {
                constructFunc(this, callCtor, ...args);
            }
        };
        cls.prototype.__cname = typeof arg === "string" ? arg : name;
        cls.prototype.__ctype = 2; // lua
    } else {
        if (typeof superClass !== "function") superClass = superClass.constructor || superClass.prototype.constructor;
        cls = class l2jChildClass extends superClass {
            public constructor(callCtor: boolean, ...args: any[]) {
                super(callCtor, ...args);
                constructFunc(this, callCtor, ...args);
            }
        };
        cls.Super = superClass;
        cls.prototype.Super = superClass;
        cls.prototype.__cname = typeof arg === "string" ? arg : name;
        cls.prototype.__ctype = 1;
    }

    cls.new = function (...args: any[]) {
        return new cls(true, ...args);
    };
    cls.New = cls.new;

    // 这里之所以直接返实例，是因为外面可以拿着class当实例去掉
    let instance = new cls(false);
    instance.prototype = cls.prototype ?? {};
    instance.New = cls.new;
    instance.new = cls.new;
    return instance;
};

l2j.finishClass = function (obj: any) {
    let cls: any;
    let pt: any;
    if (typeof obj === "function") {
        cls = obj;
        pt = cls.prototype;
    } else {
        cls = obj.constructor;
        pt = obj.prototype ?? cls.prototype;
        // if (obj.prototype) delete obj.prototype;
    }

    let sFuncs = new Set();
    let pFuncs = new Set();
    for (let k in pt) {
        if (k === "new") continue;
        let f = pt[k];
        if (typeof f === "function") pFuncs.add(k);
    }

    // 拷贝所有静态函数到prototype中
    for (const k in obj) {
        if (k === "new" || k === "__sFuncs" || k === "__pFuncs") continue;

        let func = obj[k];
        pt[k] = func;

        if (typeof func === "function" && !pFuncs.has(func)) sFuncs.add(func);
    }

    pt.__sFuncs = sFuncs;
    pt.__pFuncs = pFuncs;
};

// l2j.newInstance = function (ctor: any): any {
//     let instance = l2j.createClass(ctor.name, ctor);

//     let ret = new ctor() as any;
//     let pt = ctor.prototype;
//     for (const methodName of Object.getOwnPropertyNames(ctor)) {
//         if (methodName === "new") continue;

//         let func = ctor[methodName];
//         if (typeof func == "function") {
//             ret[methodName] = func;
//         }
//     }
//     return ret;
// };

const EMPTY_ARRAY = [] as any[];
l2j.ipairs = luaApi.ipairs;

// l2j.ipairs = function (t: any): any[] {
//     let values = Object.entries(t);
//     let ret = [] as any[];
//     for (let i = 0; i < values.length; i++) {
//         if (values[i]) ret.push(values[i]);
//     }
//     return ret;
// };

l2j.pairs = function (t: any): any[] {
    const pairs = [];
    let v;
    for (let k in t) {
        v = t[k];
        if (v !== undefined) pairs.push([k, v]);
    }
    return pairs;
};
l2j.require = function (p: string) {
    let tempPath = p.replaceAll(".", "/");
    if (tempPath in globalLib) return globalLib[tempPath];

    if (tempPath.indexOf("ZH_CN") >= 0) {
        let i = 0;
    }
    let fullPath = path.resolve(__dirname, tempPath + ".js");
    let ret = require(fullPath);
    return ret.default ?? ret;
};

l2j.createTable = function (...args: any[]) {
    let ret: any = {};
    for (let i = 0; i < args.length; i += 2) {
        ret[args[i]] = args[i + 1];
    }
    return ret;
};

l2j.rapidjson = {
    encode: function (t: any) {
        let v = convertLuaTableToJsArray(t);
        return JSON.stringify(v);
    },
    decode: function (s: string) {
        try {
            if (s.trim().length === 0) return {};

            let r = JSON.parse(s);
            return convertJsArrayToLuaTable(r);
        } catch (e: any) {
            console.error(e.message);
        }
    },
};
globalLib.rapidjson = l2j.rapidjson;

l2j.assert = function (condition: any, message?: string) {
    if (!condition) throw new Error(message);
};

l2j.typeof = function (obj: any) {
    // return puer.$typeof(obj);
    throw new Error("typeof not supported");
};

l2j.luaType = function (obj: any) {
    let t = typeof obj;
    if (t === "object") return "object";
    else if (t === "undefined") return "nil";
    else return t;
};

l2j.callFunc = function (func: any, obj: any, ...args: any[]) {
    if (obj === undefined || obj.constructor === undefined || typeof obj !== "object") return func(obj, ...args);

    let cls: any;
    let pt: any;
    if (typeof obj === "function") {
        cls = obj;
        pt = cls.prototype;
    } else {
        cls = obj.constructor;
        pt = obj.prototype ?? cls.prototype;
    }

    let pFuncs = pt.__pFuncs;
    if (pFuncs && pFuncs.has(func)) return func.call(obj, ...args); // 成员函数，需要吃掉thisArg
    else return func(obj, ...args); // 静态函数或者其他函数直接掉，所有参数都传
};

g.tostring = String;
g.print = console.log;
g._VERSION = "Lua 5.3";

g.collectgarbage = function () {
    // gc();
};

g._G = new Proxy(
    {},
    {
        get: function (target, property) {
            return g[property] || l2j[property];
        },
        set: function (target, property, value) {
            if (property === "handler") return false;
            g[property] = value;
            return true;
        },
    }
);

g.type = function (v: any) {
    return;
};

g.next = function (t: any) {
    if (t === undefined) return undefined;
    let keys = Object.keys(t);
    let ret: any = undefined;
    for (const key of keys) {
        if (t[key] === undefined) delete t[key];
        else if (!ret) ret = key;
    }
    return ret;
};

g.xpcall = function (f: any, err: any) {
    // try {
    return f();
    // } catch (e: any) {
    //     err(e.message);
    // }
};

g.pcall = function (f: any) {
    // try {
    let ret = f();
    return [ret, ""];
    // } catch (e: any) {
    //     return [undefined, e.message];
    // }
};

g.xlua = {
    import_type: function (type: string) {
        return false;
    },
};

// g.rawequal = function() {}
// g.rawlen = function() {}
g.tonumber = Number;
g.LuaReload = function (f: string) {
    return l2j.require(f);
};

g.handler = function (obj: any, func: any) {
    return func.bind(obj);
};

g.unity_time = {
    fixedDeltaTime: 0.033,
    maximumDeltaTime: 0.033,
    timeScale: 1,
    captureFramerate: 30,
};
g.jit = undefined;
g.lua_safe_pin_bind = function () {}; // 待处理
g.G_GUIDE_FORCE_NET_COMPLETE = false;
g.IsNull = function (v: any) {
    return v === undefined || v === null;
};

// function verifyDownloadConfig() {
//     let files = CS.OldSystemLibrary.GetLuaFilesInReadAndWriteDir() as any;
//     for (let i = 0; i < files.Length; i++) {
//         let luaFile = files.get_Item(i);
//         let jsonFile = luaFile.substring(0, luaFile.length - 4) + ".json";
//         if (CS.CustomLoader.FileExistsInProject(jsonFile)) continue;

//         let content = CS.CustomLoader.ReadFileTextInProject(luaFile);
//         content = CS.OldSystemLibrary.ConvertLuaFileToJson(content);
//         content = convertJsArrayToLuaTable(JSON.parse(content));
//         CS.StaticFunctionLibrary.WriteFile(jsonFile, JSON.stringify(content));
//     }
// }

export function startLua2JsEnv() {
    // verifyDownloadConfig();
    // l2j.require("Main");
    // let instance = CS.GameInstance.instance;
    // let GameMain = g.GameMain;
    // instance.RegisterUpdate(GameMain.update);
    // instance.RegisterLateUpdate(GameMain.lateUpdate);
    // instance.RegisterFixedUpdate(GameMain.fixedUpdate);
    console.log(`startLua2JsEnv finished`);
}

g.testDebug = function (info?: any) {
    if (info === "device_action##2") {
        console.log(`testDebug ${info}`);
    }
};

console.log("Lua2Js env init finished, start battle client main");
require("./Battle/ClientMain");
