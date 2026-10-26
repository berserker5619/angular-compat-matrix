import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as TS from 'typescript';

/*
 * The smoke app imports every public export of the package and uses each component, directive
 * and pipe once, with values for its required inputs. Everything it needs is in the package's
 * typings: Angular writes each declaration's selector, inputs and standalone flag into
 * `static ɵcmp: ɵɵComponentDeclaration<…>` and friends.
 */

export interface InputInfo {
  property: string;
  alias: string;
  required: boolean;
  /** Whether the app can name `Class['property']` (it can't for protected or private members). */
  accessible: boolean;
  /** Whether users write it as a bare attribute: it takes a boolean, a string or anything. */
  bare: boolean;
}

export interface Declarable {
  id: string;
  kind: 'component' | 'directive';
  className: string;
  /** How the app can import it, when it's a public export. */
  exportName?: string;
  entry?: string;
  selector?: string;
  standalone: boolean;
  inputs: InputInfo[];
  typeParams: number;
}

export interface PipeInfo {
  id: string;
  className: string;
  exportName?: string;
  entry?: string;
  pipeName: string;
  standalone: boolean;
  /** Required arguments after the value. */
  extraArgs: number;
}

export interface ModuleInfo {
  id: string;
  exportName: string;
  entry: string;
  /** ids of the declarables and pipes it exports, directly or through re-exported modules. */
  exports: string[];
}

export interface ServiceInfo {
  exportName: string;
  entry: string;
  typeParams: number;
}

export interface PublicApi {
  entries: string[];
  declarables: Declarable[];
  pipes: PipeInfo[];
  modules: ModuleInfo[];
  services: ServiceInfo[];
}

/** Import paths of every entry point the package's `exports` map declares. */
export function entryPoints(manifest: { name: string; exports?: unknown; typings?: string; types?: string }): string[] {
  const exportsMap = manifest.exports;
  if (!exportsMap || typeof exportsMap !== 'object') return [manifest.name];
  const entries: string[] = [];
  for (const [key, value] of Object.entries(exportsMap as Record<string, unknown>)) {
    if (!key.startsWith('.') || key.includes('*') || key === './package.json') continue;
    if (/\.(css|scss|json)$/.test(key)) continue;
    if (!hasTypes(value)) continue;
    entries.push(key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`);
  }
  return entries.length ? entries : [manifest.name];
}

function hasTypes(value: unknown): boolean {
  if (typeof value === 'string') return value.endsWith('.d.ts');
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([k, v]) => k === 'types' || k === 'typings' || hasTypes(v));
}

/** Reads the package's public API with the TypeScript the app itself installed. */
export function readPublicApi(appDir: string, entries: string[]): PublicApi {
  const require = createRequire(join(appDir, 'package.json'));
  const ts = require('typescript') as typeof TS;
  const probe = join(appDir, 'src', '__ngm_probe.ts');
  writeFileSync(probe, entries.map((e, i) => `import * as e${i} from ${JSON.stringify(e)};\nvoid e${i};`).join('\n'));
  try {
    const program = ts.createProgram([probe], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    });
    return new ApiReader(ts, program).read(program.getSourceFile(probe)!, entries);
  } finally {
    rmSync(probe, { force: true });
  }
}

class ApiReader {
  private readonly ts: typeof TS;
  private readonly checker: TS.TypeChecker;
  private readonly byNode = new Map<TS.ClassDeclaration, string>();
  private readonly api: PublicApi = { entries: [], declarables: [], pipes: [], modules: [], services: [] };
  private nextId = 0;

  constructor(ts: typeof TS, program: TS.Program) {
    this.ts = ts;
    this.checker = program.getTypeChecker();
  }

  read(probe: TS.SourceFile, entries: string[]): PublicApi {
    const ts = this.ts;
    const pendingModules: Array<{ node: TS.ClassDeclaration; info: ModuleInfo }> = [];
    const imports = probe.statements.filter(ts.isImportDeclaration);
    imports.forEach((statement, index) => {
      const entry = entries[index];
      const moduleSymbol = this.checker.getSymbolAtLocation(statement.moduleSpecifier);
      if (!moduleSymbol) throw new Error(`TypeScript can't resolve ${entry} in the smoke app.`);
      this.api.entries.push(entry);
      for (const exported of this.checker.getExportsOfModule(moduleSymbol)) {
        const target = exported.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(exported) : exported;
        const node = target.declarations?.find(ts.isClassDeclaration);
        if (!node) continue;
        const kind = this.classify(node, exported.name, entry);
        if (kind?.module) pendingModules.push({ node, info: kind.module });
      }
    });
    for (const { node, info } of pendingModules) info.exports = this.moduleExports(node, new Set());
    return this.api;
  }

  private staticType(node: TS.ClassDeclaration, name: string): TS.TypeReferenceNode | undefined {
    const ts = this.ts;
    for (const member of node.members) {
      if (!ts.isPropertyDeclaration(member) || !member.type) continue;
      if (!member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue;
      if (member.name.getText() !== name) continue;
      if (ts.isTypeReferenceNode(member.type)) return member.type;
    }
    return undefined;
  }

  private classify(node: TS.ClassDeclaration, exportName: string | undefined, entry: string | undefined): { module?: ModuleInfo } | undefined {
    const known = this.byNode.get(node);
    if (known) {
      this.setExportName(known, exportName, entry);
      return undefined;
    }
    const cmp = this.staticType(node, 'ɵcmp');
    const dir = this.staticType(node, 'ɵdir');
    const pipe = this.staticType(node, 'ɵpipe');
    const mod = this.staticType(node, 'ɵmod');
    const prov = this.staticType(node, 'ɵprov');
    const id = `d${this.nextId++}`;
    const className = node.name?.text ?? 'Anonymous';
    if (cmp || dir) {
      const args = (cmp ?? dir)!.typeArguments ?? [];
      this.byNode.set(node, id);
      this.api.declarables.push({
        id,
        kind: cmp ? 'component' : 'directive',
        className,
        exportName,
        entry,
        selector: this.literal(args[1]),
        standalone: this.literal(args[7]) === 'true',
        inputs: this.inputs(node, args[3]),
        typeParams: node.typeParameters?.length ?? 0,
      });
      return {};
    }
    if (pipe) {
      const args = pipe.typeArguments ?? [];
      this.byNode.set(node, id);
      this.api.pipes.push({
        id,
        className,
        exportName,
        entry,
        pipeName: this.literal(args[1]) ?? '',
        standalone: this.literal(args[2]) === 'true',
        extraArgs: this.pipeExtraArgs(node),
      });
      return {};
    }
    if (mod) {
      this.byNode.set(node, id);
      if (!exportName || !entry) return {};
      const info: ModuleInfo = { id, exportName, entry, exports: [] };
      this.api.modules.push(info);
      return { module: info };
    }
    if (prov && exportName && entry) {
      this.byNode.set(node, id);
      this.api.services.push({ exportName, entry, typeParams: node.typeParameters?.length ?? 0 });
    }
    return undefined;
  }

  private setExportName(id: string, exportName: string | undefined, entry: string | undefined): void {
    if (!exportName || !entry) return;
    const item = this.api.declarables.find((d) => d.id === id) ?? this.api.pipes.find((p) => p.id === id);
    if (item && !item.exportName) {
      item.exportName = exportName;
      item.entry = entry;
    }
  }

  /** What an NgModule exports: `static ɵmod: ɵɵNgModuleDeclaration<M, Declarations, Imports, Exports>`. */
  private moduleExports(node: TS.ClassDeclaration, seen: Set<TS.ClassDeclaration>): string[] {
    const ts = this.ts;
    if (seen.has(node)) return [];
    seen.add(node);
    const exportsArg = this.staticType(node, 'ɵmod')?.typeArguments?.[3];
    if (!exportsArg || !ts.isTupleTypeNode(exportsArg)) return [];
    const ids: string[] = [];
    for (const element of exportsArg.elements) {
      if (!ts.isTypeQueryNode(element)) continue;
      let symbol = this.checker.getSymbolAtLocation(element.exprName);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = this.checker.getAliasedSymbol(symbol);
      const target = symbol?.declarations?.find(ts.isClassDeclaration);
      if (!target) continue;
      if (this.staticType(target, 'ɵmod')) {
        if (!this.byNode.has(target)) this.classify(target, undefined, undefined);
        ids.push(...this.moduleExports(target, seen));
        continue;
      }
      if (!this.byNode.has(target)) this.classify(target, undefined, undefined);
      const id = this.byNode.get(target);
      if (id) ids.push(id);
    }
    return ids;
  }

  private literal(node: TS.TypeNode | undefined): string | undefined {
    const ts = this.ts;
    if (!node) return undefined;
    if (ts.isLiteralTypeNode(node)) {
      const literal = node.literal;
      if (ts.isStringLiteral(literal)) return literal.text;
      if (literal.kind === ts.SyntaxKind.TrueKeyword) return 'true';
      if (literal.kind === ts.SyntaxKind.FalseKeyword) return 'false';
    }
    return undefined;
  }

  /** Inputs map: `{ prop: "alias" }` before Angular 16, `{ prop: { alias; required; isSignal } }` since. */
  private inputs(node: TS.ClassDeclaration, map: TS.TypeNode | undefined): InputInfo[] {
    const ts = this.ts;
    if (!map || !ts.isTypeLiteralNode(map)) return [];
    const inputs: InputInfo[] = [];
    for (const member of map.members) {
      if (!ts.isPropertySignature(member) || !member.type) continue;
      const property = ts.isStringLiteral(member.name) || ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
      let alias = property;
      let required = false;
      if (ts.isLiteralTypeNode(member.type)) {
        alias = this.literal(member.type) ?? property;
      } else if (ts.isTypeLiteralNode(member.type)) {
        for (const field of member.type.members) {
          if (!ts.isPropertySignature(field) || !field.type) continue;
          const key = ts.isStringLiteral(field.name) || ts.isIdentifier(field.name) ? field.name.text : '';
          if (key === 'alias') alias = this.literal(field.type) ?? property;
          if (key === 'required') required = this.literal(field.type) === 'true';
        }
      }
      inputs.push({ property, alias, required, accessible: this.isPublicMember(node, property), bare: this.usedBare(node, property) });
    }
    return inputs;
  }

  /**
   * Whether users write this input as a bare attribute (`<div myFlag>`): it takes a boolean,
   * a string, or anything. A number or object input is bound to a value instead.
   */
  private usedBare(node: TS.ClassDeclaration, property: string): boolean {
    const ts = this.ts;
    const write = this.inputWriteType(node, property);
    if (!write) return true;
    const parts = write.isUnion() ? write.types : [write];
    // A union of other string literals ('ltr' | 'rtl') is bound to a value, like a number.
    const flags = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.String | ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral;
    return parts.some(
      (part) => (part.flags & flags) !== 0 || (part.isStringLiteral() && part.value === ''),
    );
  }

  /** The type a binding to the input must have: a signal input's write type, `ngAcceptInputType_*`, or the property's type. */
  private inputWriteType(node: TS.ClassDeclaration, property: string): TS.Type | undefined {
    const ts = this.ts;
    if (!node.name) return undefined;
    const classSymbol = this.checker.getSymbolAtLocation(node.name);
    if (!classSymbol) return undefined;
    const accept = this.checker.getTypeOfSymbolAtLocation(classSymbol, node).getProperty(`ngAcceptInputType_${property}`);
    if (accept) return this.checker.getTypeOfSymbolAtLocation(accept, node);
    const setter = this.setter(node, property);
    if (setter?.parameters[0]) return this.checker.getTypeAtLocation(setter.parameters[0]);
    const member = this.checker.getDeclaredTypeOfSymbol(classSymbol).getProperty(property);
    if (!member) return undefined;
    const type = this.checker.getTypeOfSymbolAtLocation(member, node);
    const name = type.getSymbol()?.getName() ?? type.aliasSymbol?.getName();
    const isReference = (type.flags & ts.TypeFlags.Object) !== 0 && ((type as TS.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0;
    const args = isReference ? this.checker.getTypeArguments(type as TS.TypeReference) : (type.aliasTypeArguments ?? []);
    if (name === 'InputSignalWithTransform') return args[1];
    if (name === 'InputSignal' || name === 'ModelSignal') return args[0];
    return type;
  }

  /** An input written through a setter, whose type can differ from what the getter returns. */
  private setter(node: TS.ClassDeclaration, name: string): TS.SetAccessorDeclaration | undefined {
    const ts = this.ts;
    return node.members.find(
      (m): m is TS.SetAccessorDeclaration => ts.isSetAccessorDeclaration(m) && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) && m.name.text === name,
    );
  }

  private isPublicMember(node: TS.ClassDeclaration, name: string): boolean {
    const ts = this.ts;
    // `Class['prop']` is the getter's type; a setter's type can't be named, so those get `any`.
    if (this.setter(node, name)) return false;
    const member = node.members.find((m) => m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) && m.name.text === name);
    if (!member) return false; // inherited or accessor-only: don't guess its type
    const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
    return !modifiers.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword);
  }

  private pipeExtraArgs(node: TS.ClassDeclaration): number {
    const ts = this.ts;
    const transforms = node.members.filter(
      (m): m is TS.MethodDeclaration => ts.isMethodDeclaration(m) && m.name.getText() === 'transform',
    );
    if (!transforms.length) return 0;
    const required = transforms.map(
      (method) => method.parameters.filter((p) => !p.questionToken && !p.initializer && !p.dotDotDotToken).length,
    );
    return Math.max(0, Math.min(...required) - 1);
  }
}

// ---------------------------------------------------------------- rendering

export interface ParsedSelector {
  tag?: string;
  attributes: Array<{ name: string; value?: string }>;
  classes: string[];
}

/** The first usable alternative of a selector like `button[mat-button], a[mat-button]`. */
export function parseSelector(selector: string): ParsedSelector | undefined {
  for (const raw of splitTopLevel(selector)) {
    const part = raw.replace(/:not\([^)]*\)/g, '').trim();
    if (!part) continue;
    const tag = /^[a-zA-Z][\w-]*/.exec(part)?.[0];
    const attributes = [...part.matchAll(/\[([^\]=~|^$*\s]+)\s*(?:[~|^$*]?=\s*["']?([^"'\]]*)["']?)?\]/g)].map((m) => ({
      name: m[1],
      value: m[2],
    }));
    const classes = [...part.replace(/\[[^\]]*\]/g, '').matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    if (!tag && !attributes.length && !classes.length) continue;
    return { tag, attributes, classes };
  }
  return undefined;
}

function splitTopLevel(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts;
}

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

export interface SmokeOptions {
  /** `ɵINPUT_SIGNAL_BRAND_WRITE_TYPE` exists in @angular/core 17.1 and later. */
  signalWriteBrand: boolean;
}

export interface SmokeFiles {
  component: string;
  main: string;
  /** What the template uses, for the report. */
  counts: { components: number; directives: number; pipes: number; modules: number; services: number };
}

export function renderSmoke(api: PublicApi, options: SmokeOptions): SmokeFiles {
  const names = new Map<string, string>(); // `${entry}\u0000${export}` -> local identifier
  const used = new Set(['Component', 'CUSTOM_ELEMENTS_SCHEMA', 'inject', 'NgmSmoke', 'NgmWrite']);
  const local = (entry: string, exportName: string) => {
    const key = `${entry}\u0000${exportName}`;
    let name = names.get(key);
    if (!name) {
      name = exportName;
      for (let n = 2; used.has(name); n++) name = `${exportName}_${n}`;
      used.add(name);
      names.set(key, name);
    }
    return name;
  };

  /*
   * Each use gets a small component of its own, the way an app uses a library: one standalone
   * declarable, or one NgModule and what it exports. Exports that are never meant to share a
   * template (two components with the same selector, say) never do.
   */
  interface Use {
    imports: string[];
    template: string[];
    fields: string[];
  }
  const uses: Use[] = [];
  const counts = { components: 0, directives: 0, pipes: 0, modules: 0, services: 0 };
  let field = 0;

  const element = (declarable: Declarable, fields: string[]): string | undefined => {
    const selector = declarable.selector ? parseSelector(declarable.selector) : undefined;
    if (!selector) return undefined;
    const selectorAttributes = new Set(selector.attributes.map((a) => a.name));
    // Required inputs get a value; so does a selector attribute that is a number or object input,
    // since users bind those rather than writing them bare.
    const bound = declarable.inputs.filter((i) => i.required || (selectorAttributes.has(i.alias) && !i.bare));
    const boundAliases = new Set(bound.map((i) => i.alias));
    const attrs: string[] = [];
    for (const attribute of selector.attributes) {
      if (boundAliases.has(attribute.name)) continue;
      attrs.push(attribute.value === undefined ? attribute.name : `${attribute.name}="${escapeAttr(attribute.value)}"`);
    }
    if (selector.classes.length) attrs.push(`class="${selector.classes.join(' ')}"`);
    for (const input of bound) {
      const name = `v${field++}`;
      const type =
        declarable.exportName && declarable.entry && input.accessible
          ? writeType(local(declarable.entry, declarable.exportName), declarable.typeParams, input.property)
          : 'any';
      fields.push(`  protected readonly ${name} = undefined as unknown as ${type};`);
      attrs.push(`[${input.alias}]="${name}"`);
    }
    const tag = selector.tag ?? 'div';
    const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
    counts[declarable.kind === 'component' ? 'components' : 'directives']++;
    return VOID_ELEMENTS.has(tag.toLowerCase()) ? open : `${open}</${tag}>`;
  };

  const pipeUse = (pipe: PipeInfo, fields: string[]): string => {
    if (!fields.some((f) => f.includes('pipeValue'))) {
      fields.push('  protected readonly pipeValue: any = undefined;', '  protected readonly pipeArg: any = undefined;');
    }
    counts.pipes++;
    const args = Array.from({ length: pipe.extraArgs }, () => ' : pipeArg').join('');
    return `<span>{{ pipeValue | ${pipe.pipeName}${args} }}</span>`;
  };

  // An NgModule, with everything it exports used in one template, as its users would.
  for (const module of api.modules) {
    const use: Use = { imports: [local(module.entry, module.exportName)], template: [], fields: [] };
    counts.modules++;
    for (const id of module.exports) {
      const declarable = api.declarables.find((d) => d.id === id);
      const pipe = api.pipes.find((p) => p.id === id);
      const line = declarable ? element(declarable, use.fields) : pipe?.pipeName ? pipeUse(pipe, use.fields) : undefined;
      if (line) use.template.push(line);
    }
    uses.push(use);
  }
  // Standalone declarables and pipes, one at a time. Only those with a selector are imported: an
  // abstract base directive can't go in `imports`, and an unused import is a warning.
  const importable = (item: { standalone: boolean; exportName?: string; entry?: string }) =>
    item.standalone && Boolean(item.exportName && item.entry);
  for (const declarable of api.declarables) {
    if (!importable(declarable)) continue;
    const use: Use = { imports: [], template: [], fields: [] };
    const line = element(declarable, use.fields);
    if (!line) continue;
    use.imports.push(local(declarable.entry!, declarable.exportName!));
    use.template.push(line);
    uses.push(use);
  }
  for (const pipe of api.pipes) {
    if (!importable(pipe) || !pipe.pipeName) continue;
    const use: Use = { imports: [local(pipe.entry!, pipe.exportName!)], template: [], fields: [] };
    use.template.push(pipeUse(pipe, use.fields));
    uses.push(use);
  }

  const rootFields: string[] = [];
  for (const service of api.services) {
    const name = local(service.entry, service.exportName);
    const type = service.typeParams ? `${name}<${Array(service.typeParams).fill('any').join(', ')}>` : name;
    rootFields.push(`  protected readonly s${field++} = inject<${type}>(${name}, { optional: true });`);
    counts.services++;
  }
  // Namespace imports pull every export into the bundle, so the linker sees every declaration.
  const namespaces = api.entries.map((entry, i) => `import * as ngmEntry${i} from ${JSON.stringify(entry)};`);
  rootFields.unshift(`  protected readonly ngmEntries = [${api.entries.map((_, i) => `ngmEntry${i}`).join(', ')}];`);

  const named = new Map<string, string[]>();
  for (const [key, localName] of names) {
    const [entry, exportName] = key.split('\u0000');
    const list = named.get(entry) ?? [];
    list.push(exportName === localName ? exportName : `${exportName} as ${localName}`);
    named.set(entry, list);
  }
  const namedImports = [...named].map(([entry, list]) => `import { ${list.sort().join(', ')} } from ${JSON.stringify(entry)};`);

  const coreImports = ['Component', 'CUSTOM_ELEMENTS_SCHEMA', 'inject'];
  if (options.signalWriteBrand) coreImports.push('ɵINPUT_SIGNAL_BRAND_WRITE_TYPE');
  const writeHelper = options.signalWriteBrand
    ? `type NgmWrite<S, I, K extends keyof I> = I[K] extends { [ɵINPUT_SIGNAL_BRAND_WRITE_TYPE]: infer W }
  ? W
  : S extends { [P in \`ngAcceptInputType_\${K & string}\`]: infer A }
    ? A
    : I[K];`
    : `type NgmWrite<S, I, K extends keyof I> = S extends { [P in \`ngAcceptInputType_\${K & string}\`]: infer A } ? A : I[K];`;

  const component = (name: string, selector: string, imports: string[], template: string[], fields: string[]) => `@Component({
  selector: '${selector}',
  standalone: true,
  imports: [${imports.join(', ')}],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: \`
${template.map((line) => '    ' + escapeTemplate(line)).join('\n')}
  \`,
})
${name === 'NgmSmoke' ? 'export ' : ''}class ${name} {
${fields.join('\n')}
}
`;
  const useNames = uses.map((_, i) => `NgmUse${i}`);
  const source = `// Generated by ng-matrix: uses every public export of the package once.
import { ${coreImports.join(', ')} } from '@angular/core';
${namespaces.join('\n')}
${namedImports.join('\n')}

/** The type a template binding to this input must have. */
${writeHelper}

${uses.map((use, i) => component(useNames[i], `ngm-use-${i}`, use.imports, use.template, use.fields)).join('\n')}
${component(
  'NgmSmoke',
  'app-root',
  useNames,
  useNames.map((_, i) => `<ngm-use-${i}></ngm-use-${i}>`),
  rootFields,
)}`;
  const main = `// Generated by ng-matrix.
import { bootstrapApplication } from '@angular/platform-browser';
import { NgmSmoke } from './ngm-smoke';

bootstrapApplication(NgmSmoke).catch((error) => console.error(error));
`;
  return { component: source, main, counts };
}

function writeType(className: string, typeParams: number, property: string): string {
  const instance = typeParams ? `${className}<${Array(typeParams).fill('any').join(', ')}>` : className;
  return `NgmWrite<typeof ${className}, ${instance}, ${JSON.stringify(property)}>`;
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;');
}

function escapeTemplate(line: string): string {
  return line.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

export function hasSignalWriteBrand(appDir: string): boolean {
  const require = createRequire(join(appDir, 'package.json'));
  try {
    const manifest = require.resolve('@angular/core/package.json');
    const version = (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
    const [major, minor] = version.split('.').map(Number);
    return major > 17 || (major === 17 && minor >= 1);
  } catch {
    return false;
  }
}

export function writeSmoke(appDir: string, files: SmokeFiles): void {
  writeFileSync(join(appDir, 'src', 'ngm-smoke.ts'), files.component);
  writeFileSync(join(appDir, 'src', 'ngm-main.ts'), files.main);
}

export function smokeExists(appDir: string): boolean {
  return existsSync(join(appDir, 'src', 'ngm-smoke.ts'));
}
