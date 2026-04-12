/**
 * Simple DynamoDB ORM
 * 
 * Features:
 * - static configure(client, config?): Configure DynamoDB client (optional - auto-configures with defaults if not called)
 * - save(): Insert or update an item
 * - update(attributes): Partially update specific attributes
 * - delete(): Remove the item
 * - static get(sortKey): Retrieve a single item by sort key (hash key is automatic)
 * - static query(options?): Query items with sort key conditions
 * - static queryAll(limit?): Get all items
 * - static queryStartsWith(prefix, limit?): Query with sort key prefix
 * - static queryBetween(start, end, limit?): Query with sort key range
 * - static queryGreaterThan(value, limit?): Query sort key > value
 * - static queryLessThan(value, limit?): Query sort key < value
 * - static queryEquals(value, limit?): Query sort key = value (returns array)
 * - loadLinks(): Load linked entities from their IDs
 * - @Link(EntityClass): Decorator for linked entity properties (cascade save)
 * - @ToDbModel: Decorator for custom data transformation before saving to DB
 * - @FromDbModel: Decorator for custom data transformation after loading from DB
 * 
 * Sort Key Conditions:
 * - equals: Exact match
 * - startsWith: Prefix match
 * - greaterThan / greaterThanOrEqual
 * - lessThan / lessThanOrEqual
 * - between: Range query
 * 
 * Usage:
 * 1. (Optional) Configure DynamoDB client at app startup:
 *    BaseEntity.configure(new DynamoDBClient({ region: 'us-east-1' }))
 *    Or pass dbClient to @Entity decorator: @Entity('Table', 'HashKey', 'SortKey', dbClient)
 * 2. Extend your class from BaseEntity
 * 3. Decorate your class with @Entity(tableName, hashKeyName, sortKeyName?, dbClient?)
 * 4. Add @HashKeyValue to the getter that returns the hash key value
 * 5. Add @SortKeyValue to the getter that returns the sort key value (if applicable)
 * 6. Optionally add @ToDbModel and @FromDbModel for custom data transformations
 * 7. Call super() in your constructor
 * 8. Make all constructor parameters optional (with default values) for static methods to work
 * 9. Use the CRUD and query methods
 * 
 * Requirements:
 * - npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    UpdateCommand,
    DeleteCommand,
    QueryCommand
} from '@aws-sdk/lib-dynamodb';

// Metadata storage
const HASH_KEY_METADATA = Symbol('hashKey');
const SORT_KEY_METADATA = Symbol('sortKey');
const LINKS_METADATA = Symbol('links');
const TO_DB_MODEL_METADATA = Symbol('toDbModel');
const FROM_DB_MODEL_METADATA = Symbol('fromDbModel');

interface LinkMetadata {
    propertyKey: string;
    entityClass: new (...args: any[]) => BaseEntity;
}

// Sort key condition types
type SortKeyCondition =
    | { type: 'equals'; value: any }
    | { type: 'lessThan'; value: any }
    | { type: 'lessThanOrEqual'; value: any }
    | { type: 'greaterThan'; value: any }
    | { type: 'greaterThanOrEqual'; value: any }
    | { type: 'between'; start: any; end: any }
    | { type: 'startsWith'; value: string };

interface QueryOptions {
    sortKeyCondition?: SortKeyCondition;
    limit?: number;
    scanIndexForward?: boolean; // true = ascending, false = descending
}

// DynamoDB client setup (must be configured via BaseEntity.configure())
let client: DynamoDBClient | undefined = undefined;
let docClient: DynamoDBDocumentClient | undefined = undefined;

function getDocClient(): DynamoDBDocumentClient {
    if (!docClient) {
        throw new Error(
            'DynamoDB client not configured. Call BaseEntity.configure(new DynamoDBClient({...})) before using the ORM.'
        );
    }
    return docClient;
}

interface EntityMetadata {
    tableName?: string;
    hashKeyName: string;
    sortKeyName?: string;
    hashKeyGetter?: string;
    sortKeyGetter?: string;
}

// Base class with ORM methods
export class BaseEntity {
    createdAt: Date = new Date();
    updatedAt: Date = new Date();

    protected getMetadata(): EntityMetadata {
        return (this.constructor as any).__entityMetadata__;
    }

    protected getKey() {
        const metadata = this.getMetadata();
        const key: any = {};

        if (metadata.hashKeyGetter) {
            key[metadata.hashKeyName] = (this as any)[metadata.hashKeyGetter];
        }

        if (metadata.sortKeyName && metadata.sortKeyGetter) {
            key[metadata.sortKeyName] = (this as any)[metadata.sortKeyGetter];
        }

        return key;
    }

    protected toItem() {
        const item: any = { ...this };

        const metadata = this.getMetadata();
        const key = this.getKey();

        // Set timestamps first (before mapper, so mapper can transform them if needed)
        item.createdAt = this.createdAt.toISOString();
        item.updatedAt = new Date().toISOString();

        // Apply custom toDbModel mapper if defined
        const toDbModelMapper = (this.constructor as any)[TO_DB_MODEL_METADATA];
        if (toDbModelMapper) {
            const mappedData = (this.constructor as any)[toDbModelMapper](this);
            Object.assign(item, mappedData);
        }

        // Handle linked entities
        const links: LinkMetadata[] = (this.constructor.prototype as any)[LINKS_METADATA] || [];
        for (const link of links) {
            const value = (this as any)[link.propertyKey];
            if (value !== undefined && value !== null) {
                // Check if it's an array
                if (Array.isArray(value)) {
                    item[`__${link.propertyKey}ID`] = value.map(linkedItem => {
                        const linkedKey = linkedItem.getKey();
                        const linkedMetadata = linkedItem.getMetadata();
                        const result: any = {
                            [linkedMetadata.hashKeyName]: linkedKey[linkedMetadata.hashKeyName]
                        };
                        if (linkedMetadata.sortKeyName) {
                            result[linkedMetadata.sortKeyName] = linkedKey[linkedMetadata.sortKeyName];
                        }
                        return result;
                    });
                } else {
                    // Single item
                    const linkedItem = value as BaseEntity;
                    const linkedKey = linkedItem.getKey();
                    const linkedMetadata = linkedItem.getMetadata();
                    const result: any = {
                        [linkedMetadata.hashKeyName]: linkedKey[linkedMetadata.hashKeyName]
                    };
                    if (linkedMetadata.sortKeyName) {
                        result[linkedMetadata.sortKeyName] = linkedKey[linkedMetadata.sortKeyName];
                    }
                    item[`__${link.propertyKey}ID`] = result;
                }
            }
            // Remove the actual linked items from being saved
            delete item[link.propertyKey];
        }

        return {
            ...key,
            ...item
        };
    }

    async save() {
        const metadata = this.getMetadata();

        // Save linked entities first (cascade save)
        const links: LinkMetadata[] = (this.constructor.prototype as any)[LINKS_METADATA] || [];
        for (const link of links) {
            const value = (this as any)[link.propertyKey];
            if (value !== undefined && value !== null) {
                if (Array.isArray(value)) {
                    // Save all linked entities in parallel
                    await Promise.all(value.map((linkedItem: BaseEntity) => linkedItem.save()));
                } else {
                    // Save single linked entity
                    await (value as BaseEntity).save();
                }
            }
        }

        const item = this.toItem();

        await getDocClient().send(new PutCommand({
            TableName: metadata.tableName,
            Item: item
        }));

        return this;
    }

    async update(attributes: Partial<this>) {
        const metadata = this.getMetadata();
        const key = this.getKey();

        const updateExpressions: string[] = [];
        const expressionAttributeNames: any = {};
        const expressionAttributeValues: any = {};

        let index = 0;
        for (const [attrName, attrValue] of Object.entries(attributes)) {
            updateExpressions.push(`#attr${index} = :val${index}`);
            expressionAttributeNames[`#attr${index}`] = attrName;
            expressionAttributeValues[`:val${index}`] = attrValue;
            index++;
        }

        updateExpressions.push(`#updatedAt = :updatedAt`);
        expressionAttributeNames['#updatedAt'] = 'updatedAt';
        expressionAttributeValues[':updatedAt'] = new Date().toISOString();

        await getDocClient().send(new UpdateCommand({
            TableName: metadata.tableName,
            Key: key,
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues
        }));

        Object.assign(this, attributes);
        this.updatedAt = new Date();

        return this;
    }

    async delete() {
        const metadata = this.getMetadata();
        const key = this.getKey();

        await getDocClient().send(new DeleteCommand({
            TableName: metadata.tableName,
            Key: key
        }));
    }

    async loadLinks() {
        const links: LinkMetadata[] = (this.constructor.prototype as any)[LINKS_METADATA] || [];

        for (const link of links) {
            const idField = `__${link.propertyKey}ID`;
            const idValue = (this as any)[idField];

            if (!idValue || !link.entityClass) {
                continue;
            }

            const EntityClass = link.entityClass;
            const entityMetadata = (EntityClass as any).__entityMetadata__;

            if (Array.isArray(idValue)) {
                // Load multiple entities
                const fromDbModelMapper = (EntityClass as any)[FROM_DB_MODEL_METADATA];

                const loadedEntities = await Promise.all(
                    idValue.map(async (keyObj: any) => {
                        const result = await getDocClient().send(new GetCommand({
                            TableName: entityMetadata.tableName,
                            Key: keyObj
                        }));

                        if (result.Item) {
                            let itemData = result.Item;
                            if (fromDbModelMapper) {
                                const mappedData = (EntityClass as any)[fromDbModelMapper](result.Item);
                                itemData = { ...result.Item, ...mappedData };
                            }

                            const instance = new EntityClass();
                            Object.assign(instance, itemData);
                            return instance;
                        }
                        return null;
                    })
                );

                (this as any)[link.propertyKey] = loadedEntities.filter(e => e !== null);
            } else {
                // Load single entity
                const fromDbModelMapper = (EntityClass as any)[FROM_DB_MODEL_METADATA];

                const result = await getDocClient().send(new GetCommand({
                    TableName: entityMetadata.tableName,
                    Key: idValue
                }));

                if (result.Item) {
                    let itemData = result.Item;
                    if (fromDbModelMapper) {
                        const mappedData = (EntityClass as any)[fromDbModelMapper](result.Item);
                        itemData = { ...result.Item, ...mappedData };
                    }

                    const instance = new EntityClass();
                    Object.assign(instance, itemData);
                    (this as any)[link.propertyKey] = instance;
                }
            }
        }

        return this;
    }

    // Configure DynamoDB client
    static configure(dynamoDBClient: DynamoDBClient, documentClientConfig?: any) {
        client = dynamoDBClient;
        docClient = DynamoDBDocumentClient.from(client, documentClientConfig);
    }

    static async get<T extends BaseEntity>(this: new (...args: any[]) => T, sortKeyValue: any): Promise<T | null> {
        const metadata = (this as any).__entityMetadata__;
        const tempInstance = new this() as any;

        // Get hash key value from the instance
        const hashKeyValue = metadata.hashKeyGetter ? tempInstance[metadata.hashKeyGetter] : undefined;

        const key: any = {
            [metadata.hashKeyName]: hashKeyValue
        };

        if (metadata.sortKeyName && sortKeyValue !== undefined) {
            key[metadata.sortKeyName] = sortKeyValue;
        }

        const result = await getDocClient().send(new GetCommand({
            TableName: metadata.tableName,
            Key: key
        }));

        if (!result.Item) {
            return null;
        }

        // Apply custom fromDbModel mapper if defined
        const fromDbModelMapper = (this as any)[FROM_DB_MODEL_METADATA];
        let itemData = result.Item;
        if (fromDbModelMapper) {
            const mappedData = (this as any)[fromDbModelMapper](result.Item);
            itemData = { ...result.Item, ...mappedData };
        }

        const instance = new this() as T;
        Object.assign(instance, itemData);
        return instance;
    }

    static async query<T extends BaseEntity>(this: new (...args: any[]) => T, options?: QueryOptions): Promise<T[]> {
        const metadata = (this as any).__entityMetadata__;
        const tempInstance = new this() as any;

        // Get hash key value from the instance
        const hashKeyValue = metadata.hashKeyGetter ? tempInstance[metadata.hashKeyGetter] : undefined;

        let keyConditionExpression = `#hk = :hkval`;
        const expressionAttributeNames: any = {
            '#hk': metadata.hashKeyName
        };
        const expressionAttributeValues: any = {
            ':hkval': hashKeyValue
        };

        // Add sort key condition if provided
        if (options?.sortKeyCondition && metadata.sortKeyName) {
            const sk = metadata.sortKeyName;
            expressionAttributeNames['#sk'] = sk;

            const condition = options.sortKeyCondition;
            switch (condition.type) {
                case 'equals':
                    keyConditionExpression += ` AND #sk = :skval`;
                    expressionAttributeValues[':skval'] = condition.value;
                    break;
                case 'lessThan':
                    keyConditionExpression += ` AND #sk < :skval`;
                    expressionAttributeValues[':skval'] = condition.value;
                    break;
                case 'lessThanOrEqual':
                    keyConditionExpression += ` AND #sk <= :skval`;
                    expressionAttributeValues[':skval'] = condition.value;
                    break;
                case 'greaterThan':
                    keyConditionExpression += ` AND #sk > :skval`;
                    expressionAttributeValues[':skval'] = condition.value;
                    break;
                case 'greaterThanOrEqual':
                    keyConditionExpression += ` AND #sk >= :skval`;
                    expressionAttributeValues[':skval'] = condition.value;
                    break;
                case 'between':
                    keyConditionExpression += ` AND #sk BETWEEN :skstart AND :skend`;
                    expressionAttributeValues[':skstart'] = condition.start;
                    expressionAttributeValues[':skend'] = condition.end;
                    break;
                case 'startsWith':
                    keyConditionExpression += ` AND begins_with(#sk, :skval)`;
                    expressionAttributeValues[':skval'] = condition.value;
                    break;
            }
        }

        const queryParams: any = {
            TableName: metadata.tableName,
            KeyConditionExpression: keyConditionExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues
        };

        if (options?.limit) {
            queryParams.Limit = options.limit;
        }

        if (options?.scanIndexForward !== undefined) {
            queryParams.ScanIndexForward = options.scanIndexForward;
        }

        const result = await getDocClient().send(new QueryCommand(queryParams));

        if (!result.Items || result.Items.length === 0) {
            return [];
        }

        // Apply custom fromDbModel mapper if defined
        const fromDbModelMapper = (this as any)[FROM_DB_MODEL_METADATA];

        return result.Items.map(item => {
            let itemData = item;
            if (fromDbModelMapper) {
                const mappedData = (this as any)[fromDbModelMapper](item);
                itemData = { ...item, ...mappedData };
            }

            const instance = new this() as T;
            Object.assign(instance, itemData);
            return instance;
        });
    }

    // Convenience methods for common query patterns
    static async queryAll<T extends BaseEntity>(this: new (...args: any[]) => T, limit?: number): Promise<T[]> {
        return (this as any).query({ limit });
    }

    static async queryStartsWith<T extends BaseEntity>(this: new (...args: any[]) => T, sortKeyPrefix: string, limit?: number): Promise<T[]> {
        return (this as any).query({
            sortKeyCondition: { type: 'startsWith', value: sortKeyPrefix },
            limit
        });
    }

    static async queryBetween<T extends BaseEntity>(this: new (...args: any[]) => T, start: any, end: any, limit?: number): Promise<T[]> {
        return (this as any).query({
            sortKeyCondition: { type: 'between', start, end },
            limit
        });
    }

    static async queryGreaterThan<T extends BaseEntity>(this: new (...args: any[]) => T, sortKeyValue: any, limit?: number): Promise<T[]> {
        return (this as any).query({
            sortKeyCondition: { type: 'greaterThan', value: sortKeyValue },
            limit
        });
    }

    static async queryLessThan<T extends BaseEntity>(this: new (...args: any[]) => T, sortKeyValue: any, limit?: number): Promise<T[]> {
        return (this as any).query({
            sortKeyCondition: { type: 'lessThan', value: sortKeyValue },
            limit
        });
    }

    static async queryEquals<T extends BaseEntity>(this: new (...args: any[]) => T, sortKeyValue: any, limit?: number): Promise<T[]> {
        return (this as any).query({
            sortKeyCondition: { type: 'equals', value: sortKeyValue },
            limit
        });
    }
}

export function Entity(tableName: string, hashKeyName: string, sortKeyName?: string, dbClient?: DynamoDBClient) {
    return function <T extends new (...args: any[]) => BaseEntity>(constructor: T) {
        // Configure DynamoDB client if not already configured
        if (!docClient) {
            if (dbClient) {
                // Use provided client
                BaseEntity.configure(dbClient);
            } else {
                // Use the default AWS credential/provider chain.
                BaseEntity.configure(
                    new DynamoDBClient({
                        region: process.env.AWS_REGION || 'us-east-1'
                    })
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

        // Return the constructor unchanged - metadata is now stored on it
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

export function Link(entityClass: new (...args: any[]) => BaseEntity) {
    return function (target: object, propertyKey: string) {
        // Store link metadata on the prototype
        if (!(target as any)[LINKS_METADATA]) {
            (target as any)[LINKS_METADATA] = [];
        }
        (target as any)[LINKS_METADATA].push({
            propertyKey,
            entityClass
        });
    };
}

export function ToDbModel(target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    // Store the mapper method name on the constructor
    target[TO_DB_MODEL_METADATA] = propertyKey;
    return descriptor;
}

export function FromDbModel(target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    // Store the mapper method name on the constructor
    target[FROM_DB_MODEL_METADATA] = propertyKey;
    return descriptor;
}