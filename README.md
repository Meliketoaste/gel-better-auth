# Gel/EdgeDB Adapter for Better-Auth

## Status

Probably will work for "some amount" of things:
Passing all the test.

Tests might be lacking in rigor. Since the main tests assumes you can change set id i had to change some stuff.

TODO:

- Implement missing stuff,
- Add missing operators.
- Test refactor
- Schema gen

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
```
