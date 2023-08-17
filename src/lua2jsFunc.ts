import prand from "pure-rand";

const dateFormat = require("dateformat");
const sprintf = require("sprintf-js").sprintf;

let rng = prand.xoroshiro128plus(Math.random());
let arrayWeakMap = new WeakMap<any, any>();
let l2j = {} as any;
let g = globalThis as any;
g.l2j = l2j;

// //////////////////////////////////////////////////////////////////////////////////////////////
// table
const table_length = function (t: any) {
    let length = arrayWeakMap.get(t);
    if (length !== undefined) return length;
    else if (t[1] !== undefined) {
        length = 1;
        while (t[++length] !== undefined);
        arrayWeakMap.set(t, length);
    }
    return length;
};
l2j.table_length = table_length;

l2j.table_insert = function (t: any, v: any) {
    let length = l2j.table_length(t);
    if (length === undefined) {
        length = 1;
    } else {
        ++length;
    }

    t[length] = v;
    arrayWeakMap.set(t, length);
};

l2j.table_insert_at = function (t: any, i: any, v: any) {
    let length = table_length(t);
    if (length === undefined) {
        if (i === 1) {
            t[1] = v;
            arrayWeakMap.set(t, 1);
        }
    } else if (i <= length) {
        for (let k = length + 1; k > i; --k) {
            t[k] = t[k - 1];
        }
        t[i] = v;
        arrayWeakMap.set(t, length + 1);
    }
    throw new Error("'insert' (position out of bounds)");
};

l2j.table_concat = function (t: any, v: any) {
    let length = table_length(t);
    if (length === undefined) {
        if (v !== undefined) {
            return v;
        }
    } else {
        let ret = "";
        for (let i = 1; i <= length; ++i) {
            ret += t[i];
        }
        return ret + v ?? "";
    }
    return "";
};

l2j.table_remove = function (t: any, v: any) {
    let length = table_length(t);
    if (length === undefined) return;

    for (let i = 1; i <= length; ++i) {
        if (t[i] === v) {
            for (let k = i; k < length; ++k) {
                t[k] = t[k + 1];
            }
            delete t[length];
            arrayWeakMap.set(t, length - 1);
            return;
        }
    }
};

l2j.table_serialize = function (tdata: any) {
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

l2j.table_sort = function (t: any, sortFunc: any) {
    let arr = Object.entries(t);
    arr.sort((a, b) => {
        console.log(`a: ${a[1]}, b: ${b[1]}`);
        return sortFunc(a[1], b[1]);
    });
    for (let i = 0; i < arr.length; i++) {
        t[i + 1] = arr[i][1];
    }
    return t;
};

l2j.table_unpack = function (t: any) {
    let arr = [] as any;
    Object.entries(t).forEach((v) => arr.push(v[1]));
    return arr;
};

// //////////////////////////////////////////////////////////////////////////////////////////////
// string
l2j.string_upper = function (s: string) {
    return s.toUpperCase();
};

l2j.string_sub = function (s: string, i: number, j: number) {
    return s.substring(i, j);
};

l2j.string_split = function (s: string, sep: string) {
    return s.split(sep);
};

l2j.string_reverse = function (s: string) {
    return s.split("").reverse().join("");
};

l2j.string_rep = function (s: string, n: number) {
    return s.repeat(n);
};

l2j.string_match = function (s: string, pattern: string) {
    return s.match(pattern);
};

l2j.string_lower = function (s: string) {
    return s.toLowerCase();
};

l2j.string_len = function (s: string) {
    return s.length;
};

l2j.string_join = function (s: string, sep: string) {
    return s + sep;
};

l2j.string_gsub = function (s: string, pattern: string, repl: string) {
    return s.replace(pattern, repl);
};

l2j.string_format = function (s: string, ...args: any[]) {
    return sprintf(s, ...args);
};

l2j.string_find = function (s: string, pattern: string, init?: number) {
    return s.indexOf(pattern, init);
};

l2j.string_char = function (n: number) {
    return String.fromCharCode(n);
};

l2j.string_byte = function (s: string, i: number = 1) {
    return s.charCodeAt(i);
};

// //////////////////////////////////////////////////////////////////////////////////////////////
// math
l2j.math_abs = function (n: number) {
    return Math.abs(n);
};

l2j.math_atan2 = function (y: number, x: number) {
    return Math.atan2(y, x);
};

l2j.math_ceil = function (n: number) {
    return Math.ceil(n);
};

l2j.math_cos = function (n: number) {
    return Math.cos(n);
};

l2j.math_deg = function (n: number) {
    return (n * 180) / Math.PI;
};

l2j.math_floor = function (n: number) {
    return Math.floor(n);
};

l2j.math_log = function (n: number) {
    return Math.log(n);
};

l2j.math_max = function (...args: number[]) {
    return Math.max(...args);
};

l2j.math_min = function (...args: number[]) {
    return Math.min(...args);
};

l2j.math_modf = function (n: number) {
    return [Math.floor(n), n - Math.floor(n)];
};

l2j.math_pow = function (x: number, y: number) {
    return Math.pow(x, y);
};

l2j.math_rad = function (n: number) {
    return (n * Math.PI) / 180;
};

l2j.math_random = function (min?: number, max?: number) {
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

l2j.math_randomseed = function (seed: number) {
    rng = prand.xoroshiro128plus(seed);
};

l2j.math_round = function (n: number) {
    return Math.round(n);
};

l2j.math_sin = function (n: number) {
    return Math.sin(n);
};

l2j.math_type = function (n: number) {
    return Number.isInteger(n) ? "integer" : "float";
};

// //////////////////////////////////////////////////////////////////////////////////////////////
// io
// 暂时禁了
l2j.io_close = function () {
    throw new Error("io.close not supported");
};

l2j.io_lines = function (...args: any[]) {
    throw new Error("io.lines not supported");
};

l2j.io_open = function (filename: string, mode?: string) {
    throw new Error("io.open not supported");
};

// //////////////////////////////////////////////////////////////////////////////////////////////
// package
g.pacakage = {
    path: "",
    cpath: "",
    loaded: {},
};

// //////////////////////////////////////////////////////////////////////////////////////////////
// os
l2j.os_time = function () {
    return Date.now();
};

l2j.os_exit = function () {
    throw new Error("os.exit");
};

l2j.os_date = function (format: string, time?: number) {
    return dateFormat(time ?? Date.now(), format);
};

// //////////////////////////////////////////////////////////////////////////////////////////////
// debug
l2j.debug_traceback = function (message?: string, level?: number) {
    return new Error().stack;
};

l2j.debug_getinfo = function (func: Function, what?: string) {
    return new Error().stack;
};

l2j.debug_getlocal = function (func: Function, index: number) {
    throw new Error("debug.getlocal not supported");
};

l2j.debug_getregistry = function () {
    throw new Error("debug.getregistry not supported");
};

l2j.debug_getupvalue = function (func: Function, index: number) {
    throw new Error("debug.getupvalue not supported");
};

l2j.debug_sethook = function (func: Function, hook: Function, mask: string, count: number) {
    throw new Error("debug.sethook not supported");
};

l2j.debug_setupvalue = function (func: Function, index: number, value: any) {
    throw new Error("debug.setupvalue not supported");
};

l2j.debug_upvaluejoin = function (func1: Function, index1: number, func2: Function, index2: number) {
    throw new Error("debug.upvaluejoin not supported");
};

// //////////////////////////////////////////////////////////////////////////////////////////////
// other
let classIndex = 0;
l2j.createClass = function (name: string | undefined, superClass?: any): any {
    let n = name ?? `class_${classIndex++}`;
    let ret: any;
    if (superClass === undefined) ret = class n {};
    else
        ret = class n extends superClass {
            constructor(...args: any[]) {
                super(...args);
            }
        };
    ret.new = function () {
        return new ret();
    };
    return ret;
};

const EMPTY_ARRAY = [] as any[];
l2j.ipairs = function (t: any): any[] {
    let length = table_length(t);
    // 不是数组
    if (length === undefined) return EMPTY_ARRAY;
    else return Object.entries(t);
};

l2j.require = function (p: string) {
    let fullPath = "old/" + p;
    console.error(`l2j.require: ${fullPath}`);
    // require(fullPath);
    let path = "F:/code-zero/client/trunk/ResProject/TypeScript/packages/client/src/" + p;
    console.error(`111111 ${path}`);
    require(path);
};

l2j.createTable = function (...args: any[]) {
    let ret: any = {};
    for (let i = 0; i < args.length; i += 2) {
        ret[args[i]] = args[i + 1];
    }
    return ret;
};

g.pcall = g.xpcall;
g.tostring = String;
g.print = console.log;
g._VERSION = "Lua 5.3";

g.collectgarbage = function () {
    // gc();
};

g._G = {
    next: function (t: any) {
        return t && Object.keys(t).length > 0;
    },
};

g.xpcall = function (f: any, err: any) {
    try {
        f();
    } catch (e: any) {
        err(e.message);
    }
};

g.xlua = {
    import_type: function (type: string) {
        return false;
    },
};

g.LuaReload = function (f: string) {};

// let originalRequire = module.constructor.prototype.require;
// g.module.constructor.prototype.require = function (p: string) {
//     var self = this;
//     if (p === undefined) return undefined;

//     try {
//         if (p.startsWith("old/")) {
//             p = "F:/code-zero/client/trunk/ResProject/TypeScript/packages/client/src/" + p;
//         }
//         console.error(`111111 ${p}`);
//         return self.constructor._load(p, self);
//     } catch (err: any) {
//         // if module not found, we have nothing to do, simply throw it back.
//         if (err.code === "MODULE_NOT_FOUND") {
//             throw err;
//         }

//         // Write to log or whatever
//         // console.log("Error in file: " + path);
//     }
// };
