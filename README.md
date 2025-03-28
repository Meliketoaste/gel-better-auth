# Gel/EdgeDB Adapter for Better-Auth

## Status

It works. Create an issue if something goes wrong.

TODO:

- Verify the API user end API's will work, plugins etc. Though they should work.

## Installation

Package exists at https://npmjs.com/package/gel-better-auth

```bash
npm i gel-better-auth
# or
pnpm add gel-better-auth
# or
bun add gel-better-auth
```

## Usage

```ts
import e from "./../dbschema/edgeql-js";
import { client } from './your-gel-client'

...
export const auth = betterAuth({
...
database: gelAdapter(client, e)
...
});

// to generate schema
const opts = auth.options;
const dbopts = opts.database(opts);
if (dbopts.createSchema) {
  dbopts.createSchema(opts);
}
```
