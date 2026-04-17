import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { HASH_KEY_METADATA, SORT_KEY_METADATA, LINKS_METADATA, TO_DB_MODEL_METADATA, FROM_DB_MODEL_METADATA } from './symbols';
import { BaseEntity } from './BaseEntity';
import { isClientConfigured, configureClient } from './client';

export function Entity(tableName: string, hashKeyName: string, sortKeyName?: string, dbClient?: DynamoDBClient) {
    return function <T extends new (...args: any[]) => BaseEntity>(constructor: T) {
        // Configure DynamoDB client from the decorator only when explicitly provided.
        if (!isClientConfigured() && dbClient) {
            configureClient(dbClient);
        }

        // Guard against using the reserved '__link' / '__backlink' hash key values.
        const hkGetter = constructor.prototype[HASH_KEY_METADATA];
        if (hkGetter) {
            const tempInstance = new constructor() as any;
            if (tempInstance[hkGetter] === '__link' || tempInstance[hkGetter] === '__backlink') {
                throw new Error(
                    `Entity "${constructor.name}" uses reserved hash key value "${tempInstance[hkGetter]}". ` +
                    `This value is reserved for internal ORM records.`
                );
            }
        }

        // Store metadata on the constructor
        (constructor as any).__entityMetadata__ = {
            tableName: tableName || constructor.name,
            hashKeyName,
            sortKeyName,
            hashKeyGetter: constructor.prototype[HASH_KEY_METADATA],
            sortKeyGetter: constructor.prototype[SORT_KEY_METADATA]
        };

        return constructor as T;
    };
}

export function HashKeyValue(target: object, propertyKey: string, descriptor?: PropertyDescriptor) {
    (target as any)[HASH_KEY_METADATA] = propertyKey;
    return descriptor;
}

export function SortKeyValue(target: object, propertyKey: string, descriptor?: PropertyDescriptor) {
    (target as any)[SORT_KEY_METADATA] = propertyKey;
    return descriptor;
}

export function LinkObject(entityClass: new (...args: any[]) => BaseEntity, options?: { inline?: boolean }) {
    return function (target: object, propertyKey: string) {
        if (!(target as any)[LINKS_METADATA]) {
            (target as any)[LINKS_METADATA] = [];
        }
        (target as any)[LINKS_METADATA].push({
            propertyKey,
            entityClass,
            inline: options?.inline,
            isArray: false
        });
    };
}

export function LinkArray(entityClass: new (...args: any[]) => BaseEntity, options?: { inline?: boolean }) {
    return function (target: object, propertyKey: string) {
        if (!(target as any)[LINKS_METADATA]) {
            (target as any)[LINKS_METADATA] = [];
        }
        (target as any)[LINKS_METADATA].push({
            propertyKey,
            entityClass,
            inline: options?.inline,
            isArray: true
        });
    };
}

export function ToDbModel(target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    target[TO_DB_MODEL_METADATA] = propertyKey;
    return descriptor;
}

export function FromDbModel(target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    target[FROM_DB_MODEL_METADATA] = propertyKey;
    return descriptor;
}
