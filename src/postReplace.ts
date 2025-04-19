import path from "path";
import fs from "fs-extra";

interface IReplaceFromTo {
    from: string;
    to: string;
}

interface IReplaceInfo {
    file: string;
    replaces: Array<IReplaceFromTo>;
}

const REPLACE_INFOS: Array<IReplaceInfo> = [
    {
        file: "Battle/Framework/Commom/TableUtil.js",
        replaces: [
            {
                from: "_, _",
                to: "_, _1",
            },
        ],
    },
];

export async function replaceContent(dest: string) {
    for (const info of REPLACE_INFOS) {
        const filePath = path.resolve(dest, info.file);
        if (!fs.existsSync(filePath)) continue;

        let content = fs.readFileSync(filePath, "utf-8");
        for (const replace of info.replaces) {
            content = content.replaceAll(replace.from, replace.to);
        }
        fs.writeFileSync(filePath, content, "utf-8");
    }
}
