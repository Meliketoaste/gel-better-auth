import { getAuthTables } from "better-auth/db";
import type { Adapter, BetterAuthOptions, Where } from "better-auth/types";
import type { Client } from "gel";
import { withApplyDefault } from "./utils";
import { writeFile } from "fs/promises";
import { join } from "path";

const createTransform = (options: BetterAuthOptions) => {
  const schema = getAuthTables(options);

  const getField = (model: string, field: string) =>
    field === "id" ? field : (schema[model]?.fields[field]?.fieldName ?? field);

  const getType = (model: string, field: string) => {
    if (field === "id") return "id";
    const f = schema[model]?.fields[field];
    if (!f) throw new Error(`Field "${field}" not found in model "${model}"`);
    return f.references?.field === "id" ? "reference" : f.type;
  };

  const transformInput = (
    data: Record<string, any>,
    model: string,
    action: "update" | "create",
  ) => {
    const transformedData: Record<string, any> = {};
    const fields = schema[model].fields;

    for (const field in fields) {
      const value = data[field];
      if (value === undefined && !fields[field].defaultValue) {
        continue;
      }
      transformedData[fields[field].fieldName || field] = withApplyDefault(
        value,
        fields[field],
        action,
      );
    }
    return transformedData;
  };

  const transformOutput = (
    data: Record<string, any>,
    model: string,
    select: string[] = [],
  ) => {
    if (!data) return null;
    const out: Record<string, any> =
      data.id && (!select.length || select.includes("id"))
        ? { id: data.id }
        : {};

    for (const [key, config] of Object.entries(schema[model].fields)) {
      if (select.length && !select.includes(key)) continue;
      out[key] = data[config.fieldName || key];
    }
    return out as any;
  };

  const transformSelect = (select: string[], model: string, e: any) => {
    let clause = select.length
      ? Object.fromEntries(select.map((field) => [field, true]))
      : e[model]["*"];
    const refField = Object.keys(schema[schema[model].modelName].fields).find(
      (key) => schema[schema[model].modelName].fields[key]?.references,
    );
    if (refField)
      clause = { ...clause, [refField]: { ...e[model][refField]["*"] } };
    return [clause, refField];
  };
  const convertWhereClause = (
    where: Where[],
    model: string,
    e: any,
    obj: any,
  ) =>
    where.map((clause) => {
      const { field: _field, value, operator } = clause;
      const field = getField(model, _field);
      const type = getType(model, _field);
      switch (operator) {
        case "eq":
          if (type === "id") {
            return e.op(obj[field], "=", e.uuid(value));
          }
          if (type == "reference") {
            return e.op(obj[field].id, "=", e.uuid(value));
          }
          return e.op(obj, "=", value);
        case "in":
          if (type === "id") {
            return e.op(obj[field], "in", e.uuid(value));
          }
          if (Array.isArray(value)) {
            return e.op(
              obj[field],
              "in",
              e.array_unpack(e.literal(e.array(e.str), value)),
            );
          }
          return e.op(obj[field], "in", value);
        case "contains":
          if (type === "id") {
            return e.op(obj[field], "ilike", e.uuid(value));
          }
          if (Array.isArray(value)) {
            return e.op(
              obj[field],
              "ilike",
              e.array_unpack(e.literal(e.array(e.str), value)),
            );
          }
          return e.op(obj[field], "ilike", value);
        case "starts_with":
          return e.op(obj[field], "ilike", `${value}%`);
        case "ends_with":
          return e.op(obj[field], "ilike", `%${value}`);
        default:
          if (type == "id") {
            return e.op(obj.id, "=", e.uuid(value));
          }
          if (type == "reference") {
            return e.op(obj[field].id, "=", e.uuid(value));
          }
          return e.op(obj[field], "=", value);
      }
    });

  return {
    convertWhereClause,
    transformInput,
    transformOutput,
    getField,
    getType,
    transformSelect,
  };
};

export function gelAdapter(db: Client, e: any) {
  return (options: BetterAuthOptions = {}): Adapter => {
    const {
      transformInput,
      transformOutput,
      convertWhereClause,
      transformSelect,
    } = createTransform(options);

    const adapter: Adapter = {
      id: "gel",

      async create({ model, data, select = [] }) {
        const modelSchema = getAuthTables(options)[model].fields;
        const transformed = transformInput(data, model, "create");
        let [selectClause, refField] = transformSelect(select, model, e);

        if (refField && modelSchema[refField].references) {
          transformed[refField] = e.select(
            e[modelSchema[refField].references.model],
            () => ({
              filter_single: { id: transformed[refField] },
            }),
          );
        }

        const result = await e
          .select(e.insert(e[model], transformed), () => selectClause)
          .run(db);
        if (refField) result[refField] = result[refField]?.id;
        return transformOutput(result, model, select);
      },

      async findOne({ model, where, select = [] }) {
        let [selectClause, refField] = transformSelect(select, model, e);

        const result = await e
          .select(e[model], (obj: any) => ({
            ...selectClause,
            filter_single: where && convertWhereClause(where, model, e, obj)[0],
          }))
          .run(db);
        if (refField) result[refField] = result[refField]?.id;
        return transformOutput(result, model, select);
      },

      async findMany({ model, where, limit, offset, sortBy }) {
        const results = await e
          .select(e[model], (obj: any) => ({
            ...obj["*"],
            limit,
            offset,
            filter: where && convertWhereClause(where, model, e, obj)[0],
            order_by: sortBy?.field && {
              expression: obj[sortBy.field],
              direction: e[sortBy.direction.toUpperCase()],
            },
          }))
          .run(db);
        return results.map((record: any) => transformOutput(record, model));
      },

      async delete({ model, where }) {
        const result = await e
          .delete(e[model], (obj: any) => ({
            ...obj["*"],
            filter_single: where && convertWhereClause(where, model, e, obj)[0],
          }))
          .run(db);
        return transformOutput(result, model);
      },

      async deleteMany({ model, where }) {
        const results = await e
          .delete(e[model], (obj: any) => ({
            ...obj["*"],
            filter: where && convertWhereClause(where, model, e, obj)[0],
          }))
          .run(db);
        return results.map((record: any) => transformOutput(record, model));
      },

      async count({ model, where }) {
        return await e
          .count(
            e.select(e[model], (obj: any) => ({
              filter: where && convertWhereClause(where, model, e, obj)[0],
            })),
          )
          .run(db);
      },

      async update({ model, where, update }) {
        const query = e.select(
          e.update(e[model], (obj: any) => ({
            filter_single: where && convertWhereClause(where, model, e, obj)[0],
            set: update,
          })),
          (obj: any) => ({ ...obj["*"] }),
        );
        const result = await query.run(db);
        return transformOutput(result, model);
      },

      async updateMany({ model, where, update }) {
        const query = e.update(e[model], (obj: any) => {
          const whereclause = convertWhereClause(where, model, e, obj);
          return {
            filter: e.op(whereclause[0], "and", whereclause[1]),
            set: update,
          };
        });
        const result = await query.run(db);
        return transformOutput(result, model);
      },

      async createSchema(
        opts: BetterAuthOptions,
        file: string = "./dbschema/generated.gelschema",
      ) {
        const typeMap: Record<string, string> = {
          string: "str",
          number: "int",
          boolean: "bool",
          date: "datetime",
        };
        const schemaString = Object.values(getAuthTables(opts))
          .map(({ modelName, fields }) => {
            const fieldsString = Object.entries(fields)
              .map(
                ([fieldName, { type, required, references }]) =>
                  `  ${required ? "required " : ""}${fieldName}: ${references?.model || (Array.isArray(type) ? `array<${typeMap[type[0]]}>` : typeMap[type])};`,
              )
              .join("\n");
            return `type ${modelName} {\n${fieldsString}\n}`;
          })
          .join("\n\n");

        const filePath = join(process.cwd(), file);
        await writeFile(filePath, schemaString);
        return { code: schemaString, path: filePath, overwrite: true };
      },
    };
    return adapter;
  };
}
