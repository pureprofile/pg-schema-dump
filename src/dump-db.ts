import { log } from './utils';
import { FsSchema } from './fs-schema';
import { DbSchema } from './db-schema';

export async function dumpDb({ url, out, logger }: { url: string; out: string; logger?: typeof log | null }) {
  const _logger = logger !== undefined ? logger : log;
  const dbSchema = new DbSchema(url, _logger);
  await dbSchema.connect();
  const fsSchema = new FsSchema(out, _logger);

  _logger?.info(`connecting to database: ${url}`);
  _logger?.info(`dumping contents into: ${out}`);

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
  await dbSchema.close();
}
