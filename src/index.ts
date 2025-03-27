import { getAuthTables } from "better-auth/db";
import type { Adapter, BetterAuthOptions, Where } from "better-auth/types";
import { writeFile } from "fs/promises";
import type { Client } from "gel";
import { join } from "path";
import { withApplyDefault } from "./utils";

const createTransform = (options: BetterAuthOptions) => {
  const schema = getAuthTables(options);

  const getField = (model: string, field: string) =>
    field === "id" ? field : (schema[model]?.fields[field]?.fieldName ?? field);

  const getType = (model: string, field: string) => {
    if (field === "id") {
      return "id";
    }
    const f = schema[model]?.fields[field];
    return f.references?.field === "id" ? "reference" : f.type;
  };

  const getModelName = (model: string) => {
    return schema[model].modelName !== model ? schema[model].modelName  : model;
  };

  return {
    transformInput(
      data: Record<string, any>,
      model: string,
      action: "update" | "create",
    ) {
      const transformedData: Record<string, any> = {};
      const fields = schema[model].fields;

      for (const field in fields) {
        const value = data[field];
        if (value || fields[field].defaultValue) {
          transformedData[fields[field].fieldName || field] = withApplyDefault(
            value,
            fields[field],
            action,
          );
        }
      }
      return transformedData;
    },
    transformOutput(
      data: Record<string, any>,
      model: string,
      select: string[] = [],
    ) {
      if (!data) return null;
      const out: Record<string, any> =
        data.id && (!select.length || select.includes("id"))
          ? { id: data.id }
          : {};

      for (const [key, config] of Object.entries(schema[model].fields)) {
        if (!select.length || select.includes(key)) {
          out[key] = data[config.fieldName || key];
        }
      }
      return out as any;
    },

    convertWhere(where: Where[] | undefined, model: string, e: any, obj: any) {
      if (!where || where.length === 0) return undefined;
      const opMap: Record<string, string> = {
        eq: "=",
        ne: "!=",
        lt: "<",
        lte: "<=",
        gt: ">",
        gte: ">=",
        in: "in",
        contains: "ilike",
        starts_with: "ilike",
        ends_with: "ilike",
      };

      let combinedClause: any = null;

      where.forEach(({ field, value, operator = "eq", connector = "AND" }) => {
        const fieldName = getField(model, field);
        const type = getType(model, field);
        const leftOperand =
          type === "reference" ? obj[fieldName].id : obj[fieldName];

        let transformedValue = value;
        if (operator === "starts_with") {
          transformedValue = `${value}%`;
        } else if (operator === "ends_with") {
          transformedValue = `%${value}`;
        } else if (type === "id" || type === "reference") {
          transformedValue = e.uuid(value);
        } else if (operator === "in" && Array.isArray(value)) {
          transformedValue = e.array_unpack(e.literal(e.array(e.str), value));
        }

        const clause = e.op(leftOperand, opMap[operator], transformedValue);

        combinedClause = combinedClause
          ? e.op(combinedClause, connector.toLowerCase(), clause)
          : clause;
      });
      return combinedClause;
    },

    transformSelect(select: string[], model: string, e: any) {
      const fields = schema[model].fields;
      const modelName = schema[model].modelName;

      const clause = select.length
        ? Object.fromEntries(select.map((f) => [f, true]))
        : e[modelName]["*"];
      const referenceField = Object.keys(fields).find(
        (key) => fields[key]?.references,
      );
      if (referenceField) {
        clause[referenceField] = e[modelName][referenceField]["*"];
      }
      return [clause, referenceField];
    },
    getField,
    getType,
    getModelName
  };
};

type GelAdapterOptions = {
  moduleName?: string;
};

export function gelAdapter(db: Client, e: any, options: GelAdapterOptions = {}) {
  const qb = options?.moduleName ? e[options.moduleName] : e;

  return (options: BetterAuthOptions = {}) => {
    const { transformInput, transformOutput, convertWhere, transformSelect, getModelName } =
      createTransform(options);

    return {
      id: "gel",
      async create({ model, data, select = [] }) {
        const modelSchema = getAuthTables(options)[model].fields;
        const transformed = transformInput(data, model, "create");
        let [selectClause, referenceField] = transformSelect(select, model, qb);

        const ref = modelSchema[referenceField]?.references;
        if (ref) {
          transformed[referenceField] = e.select(qb[ref.model], {
            filter_single: { id: transformed[referenceField] },
          });
        }

        const modelName = getModelName(model);

        const query = e.select(e.insert(qb[modelName], transformed), selectClause);
        const result = await query.run(db);
        if (referenceField) result[referenceField] = result[referenceField]?.id;
        return transformOutput(result, model, select);
      },

      async findOne({ model, where, select = [] }) {
        let [selectClause, referenceField] = transformSelect(select, model, qb);
        const modelName = getModelName(model);
        const query = e.select(qb[modelName], (obj: any) => ({
          ...selectClause,
          filter_single: convertWhere(where, model, e, obj),
        }));
        const result = await query.run(db);

        if (referenceField) result[referenceField] = result[referenceField]?.id;
        return transformOutput(result, model, select);
      },

      async findMany({ model, where, limit, offset, sortBy }) {
        const modelName = getModelName(model);
        const query = e.select(qb[modelName], (obj: any) => ({
          ...obj["*"],
          limit,
          offset,
          filter: convertWhere(where, model, e, obj),
          order_by: sortBy?.field && {
            expression: obj[sortBy.field],
            direction: e[sortBy.direction.toUpperCase()],
          },
        }));
        const results = await query.run(db);
        return results.map((record: any) => transformOutput(record, model));
      },

      async delete({ model, where }) {
        const modelName = getModelName(model);
        const query = e.delete(qb[modelName], (obj: any) => ({
          ...obj["*"],
          filter_single: convertWhere(where, model, e, obj),
        }));
        const result = await query.run(db);
        return transformOutput(result, model);
      },

      async deleteMany({ model, where }) {
        const modelName = getModelName(model);
        const query = e.delete(qb[modelName], (obj: any) => ({
          ...obj["*"],
          filter: convertWhere(where, model, e, obj),
        }));
        const results = await query.run(db);
        return results.map((record: any) => transformOutput(record, model));
      },

      async count({ model, where }) {
        const modelName = getModelName(model);
        const query = e.select(qb[modelName], (obj: any) => ({
          filter: convertWhere(where, model, e, obj),
        }));
        return await e.count(query.run(db));
      },

      async update({ model, where, update }) {
        const modelName = getModelName(model);
        const updateQuery = e.update(qb[modelName], (obj: any) => ({
          filter_single: convertWhere(where, model, e, obj),
          set: update,
        }));
        const query = e.select(updateQuery, (obj: any) => obj["*"]);
        const result = await query.run(db);
        return transformOutput(result, model);
      },

      async updateMany({ model, where, update }) {
        const modelName = getModelName(model);
        const query = e.update(qb[modelName], (obj: any) => ({
          filter: convertWhere(where, model, e, obj),
          set: update,
        }));
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
    } satisfies Adapter;
  };
}
