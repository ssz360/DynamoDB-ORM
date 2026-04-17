// import type avoids a runtime circular dependency: types.ts ↔ BaseEntity.ts
import type { BaseEntity } from './BaseEntity';

export interface LinkMetadata {
    propertyKey: string;
    entityClass: new (...args: any[]) => BaseEntity;
    inline?: boolean;  // true = store IDs on parent item; false/undefined = write separate link records
    isArray: boolean;  // declared at decoration time; true = property holds an array of linked entities
}

export type SortKeyCondition =
    | { type: 'equals'; value: any }
    | { type: 'lessThan'; value: any }
    | { type: 'lessThanOrEqual'; value: any }
    | { type: 'greaterThan'; value: any }
    | { type: 'greaterThanOrEqual'; value: any }
    | { type: 'between'; start: any; end: any }
    | { type: 'startsWith'; value: string };

export interface QueryOptions {
    sortKeyCondition?: SortKeyCondition;
    limit?: number;
    scanIndexForward?: boolean; // true = ascending, false = descending
}

export interface EntityMetadata {
    tableName?: string;
    hashKeyName: string;
    sortKeyName?: string;
    hashKeyGetter?: string;
    sortKeyGetter?: string;
}
