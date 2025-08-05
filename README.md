# Gel/EdgeDB Adapter for Better-Auth


## Status

It works. For the most part.

### Issues
I was using the query builder in hopes of it making the code simpler. But i am not quite sure if it was succesfull or not. It lead to the user sort of having an chicken and egg problem. Where you need an query builder to do the schema generation so you need a schema for generating a schema. And that shouldnt be neccesary. There was some issues with plugins which i deffinfetly can fix. But im tired of thinking about web in general. So feel free to fork or ask questions. But im probably not going to bother to fix it. If you were to make your own better adapter please avoid the query builder lol. 

### Update

I will refer you to use https://github.com/carere/gel-better-auth instead of this.

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
