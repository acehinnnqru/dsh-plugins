import * as yaml from 'js-yaml'

/**
 * The loader's `!!js` dialect, copied from the DSH checkout's `vendor/include/src/index.ts:9-23`.
 *
 * This is not decoration. The loader parses every patch with `JSON_SCHEMA.extend(JsExpr)`, so a check
 * that used the default schema would disagree with boot in both directions: `DEFAULT_SCHEMA` reads
 * `yes` as `true` and bare dates as `Date`, and a schema with no `!!js` type throws
 * `unknown tag !<tag:yaml.org,2002:js>` on the first patch that uses an expression.
 */
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
})

/** The entry-list YAML dialect: `!!js` scalars parse into `{ __jsExpr }` expression nodes. */
export const entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr)

/** Parse a `cordis.patch.yml` exactly the way the loader does. Throws on invalid YAML. */
export function parseEntryList(source: string): unknown {
  return yaml.load(source, { schema: entryListSchema })
}
