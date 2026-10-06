/**
 * Response types for the endpoints added by the practice-management work.
 *
 * `core/api-types.d.ts` is generated from the live OpenAPI document and marks
 * every property optional, because springdoc does not emit `required` for
 * records. Jackson, however, always writes every record component (a `null`
 * where there is no value), so a response really does carry all of its fields.
 * {@link Wire} restores that: it is the generated shape, made deep-required,
 * so field names are still checked against the server while screens are not
 * littered with `?.` on fields that are always there.
 *
 * A field that can be `null` (a date not set yet, a name no one entered) is
 * still typed as present. Treat those defensively in templates (`x?.y`,
 * `x ?? '—'`); TypeScript will not remind you, so the DTO in the backend is
 * the reference for which ones they are.
 *
 * Never hand-write a field name here. Derive from the schema, so a backend
 * rename breaks the build. Request bodies are different: they are built by the
 * client, so they use the generated schema as-is (`Req`), where optional means
 * "may be omitted".
 */
import type { components } from '../api-types';

type Schemas = components['schemas'];

export type DeepRequired<T> = T extends readonly (infer U)[]
  ? DeepRequired<U>[]
  : T extends object
    ? { [K in keyof T]-?: DeepRequired<NonNullable<T[K]>> }
    : T;

/** A response schema, by its OpenAPI name, with every field present. */
export type Wire<K extends keyof Schemas> = DeepRequired<Schemas[K]>;

/** A request schema, by its OpenAPI name: optional fields stay optional. */
export type Req<K extends keyof Schemas> = Schemas[K];
