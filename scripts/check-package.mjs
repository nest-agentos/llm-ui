import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['@nestos/mdxeditor', '@nestos/ui-common']);
assert.match(manifest.dependencies['@nestos/mdxeditor'], /^\^?\d+\.\d+\.\d+$/);
for (const key of ['peerDependencies', 'optionalDependencies']) assert.equal(Object.keys(manifest[key] ?? {}).length, 0);
assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './flow', './flow.css', './forms', './forms.css', './settings', './settings.css', './style.css']);
for (const [name, target] of Object.entries(manifest.publishConfig.exports)) {
    for (const path of targets(target))
        assert.ok(existsSync(resolve(root, path)), `${name}: missing published artifact ${path}`);
}
function targets(value) {return typeof value === 'string' ? [value] : Object.values(value).flatMap(targets);}

// Hosts may load either the aggregate stylesheet or the standalone Flow stylesheet.
for (const entry of ['style.css', 'flow.css']) {
    const css = readFileSync(resolve(root, 'dist', entry), 'utf8');
    for (const [selector, declaration] of [
        ['.dag-canvas__surface', 'position:relative'],
        ['.dag-canvas__edges', 'position:absolute'],
        ['.dag-node', 'position:absolute'],
    ]) {
        const rule = css.split('}').find(rule => rule.trimStart().startsWith(`${selector}{`));
        assert.ok(rule?.includes(declaration), `${entry}: missing graph layout ${selector} ${declaration}`);
    }
}

function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? files(path) : /\.(?:[cm]?ts|[cm]?js)$/.test(path) ? [path] : [];
    });
}
function specifiers(text, filename) {
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true), names = new Set();
    function visit(node) {
        const literal = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
            : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal
            : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') ? node.arguments[0] : undefined;
        if (literal && ts.isStringLiteralLike(literal)) names.add(literal.text);
        ts.forEachChild(node, visit);
    }
    visit(source); return names;
}
for (const folder of ['src', 'dist']) for (const file of files(resolve(root, folder))) {
    for (const name of specifiers(readFileSync(file, 'utf8'), file)) {
        if (name.startsWith('.')) assert.ok(resolve(dirname(file), name).startsWith(root + '/'), `Escaped package: ${file} -> ${name}`);
        else assert.ok(['@nestos/mdxeditor', '@nestos/ui-common'].includes(name), `Unexpected dependency: ${file} -> ${name}`);
    }
}
process.stdout.write('Independent llm-ui source, JavaScript, declarations and exports only depend on mdxeditor and ui-common.\n');

// Optional settings cannot become reachable through the normal Chat or Flow entries.
const visited = new Set();
function inspectEntry(file) {
    if (visited.has(file)) return;
    visited.add(file);
    assert.ok(!file.startsWith(resolve(root, 'src/settings') + '/'), `Settings leaked into a main entry: ${file}`);
    assert.notEqual(file, resolve(root, 'src/settings.ts'));
    for (const name of specifiers(readFileSync(file, 'utf8'), file)) {
        if (!name.startsWith('.') || name.endsWith('.css')) continue;
        const base = resolve(dirname(file), name);
        const target = [base + '.ts', resolve(base, 'index.ts')].find(existsSync);
        if (target) inspectEntry(target);
    }
}
for (const entry of ['src/index.ts', 'src/flow.ts']) inspectEntry(resolve(root, entry));
