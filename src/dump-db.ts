import { logInfo } from './utils';
import { FsSchema } from './fs-schema';
import { DbSchema } from './db-schema';

export async function dumpDb({ url, out }: { url: string; out: string }) {
  const dbSchema = new DbSchema(url);
  const fsSchema = new FsSchema(out);

  logInfo(`connecting to database: ${url}`);
  logInfo(`dumping contents into: ${out}`);

  fsSchema.clean();
  for (const { schema, name, src } of await dbSchema.functions()) {
    fsSchema.writeFunction({ schema, name, src });
  }
  for (const { schema, table, name, src } of await dbSchema.indexes()) {
    fsSchema.writeIndex({ schema, table, name, src });
  }
  for (const { schema, name, src } of await dbSchema.views()) {
    fsSchema.writeView({ schema, name, src });
  }
  for (const { schema, table, name, src } of await dbSchema.triggers()) {
    fsSchema.writeTrigger({ schema, table, name, src });
  }
  for (const { schema, table, attributes } of await dbSchema.tables()) {
    fsSchema.writeTable({ schema, table, attributes });
  }
  dbSchema.close();
}
