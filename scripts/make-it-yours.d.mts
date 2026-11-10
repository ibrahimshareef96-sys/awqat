/** Types for make-it-yours.mjs, so its tests can import it under the repository's strict TypeScript settings. */

export interface Identity { id: string; name: string; group: string; scheme: string }
export interface Options {
  id?: string; name?: string; group?: string; scheme?: string; accent?: string;
  dryRun: boolean; force: boolean; help: boolean;
}
export interface Change { from: string; to: string; before: string; after: string }
export interface Plan { changes: Change[]; leftovers: string[]; links: string[] }
export interface Output { log(text: string): void; error(text: string): void }

export class UsageError extends Error {}
export class PatternError extends Error {}
export const USAGE: string;

export function idProblem(id: unknown): string | null;
export function nameProblem(name: unknown): string | null;
export function groupProblem(group: unknown): string | null;
export function schemeProblem(scheme: unknown): string | null;
export function accentProblem(accent: unknown): string | null;
export function parseArgs(argv: readonly string[]): Options;
export function checkOptions(options: Options): void;

export function currentIdentity(read: (file: string) => string | null): Identity;
export function nextIdentity(cur: Identity, options: Partial<Options>): Identity;

export function rewriteTokens(text: string, cur: Identity, next: Identity): string;
export function rewritePlistScheme(text: string, cur: Identity, next: Identity): string;
export function nameKind(file: string): "config" | "title" | "strings" | "plist" | "code" | null;
export function renameShown(file: string, text: string, cur: Identity, next: Identity): string;
export function nameTaken(file: string, text: string, cur: Identity, next: Identity): boolean;
export function nameLeftOn(file: string, text: string, cur: Identity, next: Identity): number[];
export function transformFile(file: string, text: string, cur: Identity, next: Identity): string;
export function destination(file: string, cur: Identity, next: Identity): string;

export function missingPlaces(texts: ReadonlyMap<string, string>, cur: Identity, next: Identity): string[];
export function alreadyTaken(texts: ReadonlyMap<string, string>, cur: Identity, next: Identity): string[];
export function leftBehind(after: ReadonlyMap<string, string>, cur: Identity, next: Identity): string[];

export function inside(root: string, file: string): string;
export function readScope(root: string): { texts: Map<string, string>; links: string[] };
export function buildPlan(root: string, cur: Identity, next: Identity): Plan;
export function applyPlan(root: string, plan: Plan): void;
export function treeState(root: string): "clean" | "dirty" | "none";
export function main(argv: readonly string[], out?: Output): number;
