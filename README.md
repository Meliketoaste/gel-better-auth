# Gel/EdgeDB Adapter for Better-Auth

## Status

Will probably work, keep in mind it's early.
Passing all the test.

TODO:

- Try it out to see if plugins, and API's will work as intended.

## Installation

Package exists now https://npmjs.com/package/gel-better-auth

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
