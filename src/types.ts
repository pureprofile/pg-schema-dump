export interface Attribute {
  table: string;
  name: string;
  type: string;
  isNotNull?: boolean;
  defaultValue: string | null;
  description: string;
  references?: Reference;
  isPrimaryKey: boolean;
}

export interface Reference {
  table: string;
  attribute: Attribute;
}
