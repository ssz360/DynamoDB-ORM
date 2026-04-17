/**
 * Simple DynamoDB ORM
 * 
 * Features:
 * - static configure(client, config?): Configure DynamoDB client
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
 * 1. Configure DynamoDB client at app startup:
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
    inline?: boolean;  // true = store IDs on parent item; false/undefined = write separate link records (default: false)
    isArray: boolean;  // declared at decoration time; true = property holds an array of linked entities
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

// Exhaustively pages through a DynamoDB query, returning all matching items.
async function paginatedQuery(params: any): Promise<any[]> {
    const items: any[] = [];
    let lastKey: Record<string, any> | undefined = undefined;
    do {
        const result: { Items?: any[]; LastEvaluatedKey?: Record<string, any> } = await getDocClient().send(new QueryCommand({
            ...params,
            ...(lastKey ? { ExclusiveStartKey: lastKey } : {})
        }));
        if (result.Items) items.push(...result.Items);
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return items;
}

// Escapes '#' in composite sort key segments to avoid prefix ambiguity.
function encodeLinkSegment(v: string): string {
    return v.replace(/#/g, '%23');
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
            const isInline = link.inline ?? false;

            if (isInline) {
                if (value !== undefined && value !== null) {
                    if (link.isArray) {
                        item[`__${link.propertyKey}ID`] = (value as BaseEntity[]).map((linkedItem: BaseEntity) => {
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
            } else {
                // Non-inline: ensure no stale __propertyID from a previous loadLinks() is persisted
                delete item[`__${link.propertyKey}ID`];
            }
            // Remove the actual linked entity instances from being saved
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

        // Write separate link records for non-inline links.
        // Record shape: { [hashKey]: '__link', [sortKey]: '{parentHK}#{parentSK}#{property}#{linkedHK}#{linkedSK}',
        //                 linkedHashKey, linkedSortKey, isArray }
        // Requires the parent entity table to have a sort key.
        const nonInlineLinks = links.filter(link => {
            const isInline = link.inline ?? false;
            return !isInline;
        });

        // Issue 2: fail fast with a clear error rather than silently skipping.
        if (nonInlineLinks.length > 0 && !metadata.sortKeyName) {
            throw new Error(
                `Entity "${metadata.tableName}" has non-inline @Link properties ` +
                `(${nonInlineLinks.map(l => l.propertyKey).join(', ')}) but no sort key. ` +
                `Non-inline links require a sort key. Use @Link(..., { inline: true }) or add a sort key.`
            );
        }

        if (metadata.sortKeyName && nonInlineLinks.length > 0) {
            const parentKey = this.getKey();
            const parentHKVal = String(parentKey[metadata.hashKeyName]);
            const parentSKVal = String(parentKey[metadata.sortKeyName]);

            for (const link of nonInlineLinks) {
                const value = (this as any)[link.propertyKey];

                // Delete all existing link records for this property before writing new ones.
                // Runs even when value is null/undefined so clearing a link removes stale records.
                const skPrefix = `${encodeLinkSegment(parentHKVal)}#${encodeLinkSegment(parentSKVal)}#${encodeLinkSegment(link.propertyKey)}#`;
                const existingItems = await paginatedQuery({
                    TableName: metadata.tableName,
                    KeyConditionExpression: '#pk = :pkval AND begins_with(#sk, :skprefix)',
                    ExpressionAttributeNames: {
                        '#pk': metadata.hashKeyName,
                        '#sk': metadata.sortKeyName!
                    },
                    ExpressionAttributeValues: {
                        ':pkval': '__link',
                        ':skprefix': skPrefix
                    }
                });
                if (existingItems.length > 0) {
                    const linkedEntityMetadata = (link.entityClass as any).__entityMetadata__;
                    await Promise.all(existingItems.map(async (rec: any) => {
                        await getDocClient().send(new DeleteCommand({
                            TableName: metadata.tableName,
                            Key: {
                                [metadata.hashKeyName]: rec[metadata.hashKeyName],
                                [metadata.sortKeyName!]: rec[metadata.sortKeyName!]
                            }
                        }));
                        // Delete corresponding back-reference from child's table
                        if (linkedEntityMetadata.sortKeyName) {
                            await getDocClient().send(new DeleteCommand({
                                TableName: linkedEntityMetadata.tableName,
                                Key: {
                                    [linkedEntityMetadata.hashKeyName]: '__backlink',
                                    [linkedEntityMetadata.sortKeyName]: `${encodeLinkSegment(rec.linkedHashKey)}#${encodeLinkSegment(rec.linkedSortKey)}#${encodeLinkSegment(metadata.tableName!)}#${encodeLinkSegment(parentHKVal)}#${encodeLinkSegment(parentSKVal)}#${encodeLinkSegment(link.propertyKey)}`
                                }
                            }));
                        }
                    }));
                }

                if (value == null) continue;

                const linkedItems: BaseEntity[] = link.isArray ? value : [value];
                await Promise.all(linkedItems.map(async (linkedItem: BaseEntity) => {
                    const linkedKey = linkedItem.getKey();
                    const linkedMeta = linkedItem.getMetadata();
                    const linkedHKVal = String(linkedKey[linkedMeta.hashKeyName]);
                    const linkedSKVal = linkedMeta.sortKeyName
                        ? String(linkedKey[linkedMeta.sortKeyName])
                        : '';

                    const linkRecord: any = {
                        [metadata.hashKeyName]: '__link',
                        [metadata.sortKeyName!]: `${encodeLinkSegment(parentHKVal)}#${encodeLinkSegment(parentSKVal)}#${encodeLinkSegment(link.propertyKey)}#${encodeLinkSegment(linkedHKVal)}#${encodeLinkSegment(linkedSKVal)}`,
                        linkedHashKey: linkedHKVal,
                        linkedSortKey: linkedSKVal,
                        isArray: link.isArray
                    };

                    await getDocClient().send(new PutCommand({
                        TableName: metadata.tableName,
                        Item: linkRecord
                    }));

                    // Write back-reference in child's table so child deletions can clean up this forward link.
                    if (linkedMeta.sortKeyName) {
                        await getDocClient().send(new PutCommand({
                            TableName: linkedMeta.tableName,
                            Item: {
                                [linkedMeta.hashKeyName]: '__backlink',
                                [linkedMeta.sortKeyName]: `${encodeLinkSegment(linkedHKVal)}#${encodeLinkSegment(linkedSKVal)}#${encodeLinkSegment(metadata.tableName!)}#${encodeLinkSegment(parentHKVal)}#${encodeLinkSegment(parentSKVal)}#${encodeLinkSegment(link.propertyKey)}`,
                                parentTableName: metadata.tableName,
                                parentHashKeyName: metadata.hashKeyName,
                                parentSortKeyName: metadata.sortKeyName,
                                parentHashKey: parentHKVal,
                                parentSortKey: parentSKVal,
                                propertyKey: link.propertyKey
                            }
                        }));
                    }
                }));
            }
        }

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

        return this;
    }

    async delete() {
        const metadata = this.getMetadata();
        const key = this.getKey();

        // Clean up non-inline link records before deleting the parent to prevent orphans.
        if (metadata.sortKeyName) {
            const links: LinkMetadata[] = (this.constructor.prototype as any)[LINKS_METADATA] || [];
            const parentHKVal = String(key[metadata.hashKeyName]);
            const parentSKVal = String(key[metadata.sortKeyName]);

            for (const link of links) {
                const isInline = link.inline ?? false;
                if (isInline) continue;

                const existingItems = await paginatedQuery({
                    TableName: metadata.tableName,
                    KeyConditionExpression: '#pk = :pkval AND begins_with(#sk, :skprefix)',
                    ExpressionAttributeNames: { '#pk': metadata.hashKeyName, '#sk': metadata.sortKeyName },
                    ExpressionAttributeValues: {
                        ':pkval': '__link',
                        ':skprefix': `${encodeLinkSegment(parentHKVal)}#${encodeLinkSegment(parentSKVal)}#${encodeLinkSegment(link.propertyKey)}#`
                    }
                });
                const linkedEntityMetadata = (link.entityClass as any).__entityMetadata__;
                await Promise.all(existingItems.map(async (rec: any) => {
                    await getDocClient().send(new DeleteCommand({
                        TableName: metadata.tableName,
                        Key: {
                            [metadata.hashKeyName]: rec[metadata.hashKeyName],
                            [metadata.sortKeyName!]: rec[metadata.sortKeyName!]
                        }
                    }));
                    // Delete corresponding back-reference from child's table
                    if (linkedEntityMetadata.sortKeyName) {
                        await getDocClient().send(new DeleteCommand({
                            TableName: linkedEntityMetadata.tableName,
                            Key: {
                                [linkedEntityMetadata.hashKeyName]: '__backlink',
                                [linkedEntityMetadata.sortKeyName]: `${encodeLinkSegment(rec.linkedHashKey)}#${encodeLinkSegment(rec.linkedSortKey)}#${encodeLinkSegment(metadata.tableName!)}#${encodeLinkSegment(parentHKVal)}#${encodeLinkSegment(parentSKVal)}#${encodeLinkSegment(link.propertyKey)}`
                            }
                        }));
                    }
                }));
            }
        }

        // Clean up forward link records pointing TO this item (child-side cleanup via back-references).
        if (metadata.sortKeyName) {
            const itemHKVal = String(key[metadata.hashKeyName]);
            const itemSKVal = String(key[metadata.sortKeyName]);
            const backlinkPrefix = `${encodeLinkSegment(itemHKVal)}#${encodeLinkSegment(itemSKVal)}#`;

            const backlinks = await paginatedQuery({
                TableName: metadata.tableName,
                KeyConditionExpression: '#pk = :pkval AND begins_with(#sk, :skprefix)',
                ExpressionAttributeNames: { '#pk': metadata.hashKeyName, '#sk': metadata.sortKeyName },
                ExpressionAttributeValues: {
                    ':pkval': '__backlink',
                    ':skprefix': backlinkPrefix
                }
            });

            await Promise.all(backlinks.map(async (backlink: any) => {
                // Delete the forward link record in the parent's table
                const fwdSKVal = `${encodeLinkSegment(backlink.parentHashKey)}#${encodeLinkSegment(backlink.parentSortKey)}#${encodeLinkSegment(backlink.propertyKey)}#${encodeLinkSegment(itemHKVal)}#${encodeLinkSegment(itemSKVal)}`;
                await getDocClient().send(new DeleteCommand({
                    TableName: backlink.parentTableName,
                    Key: {
                        [backlink.parentHashKeyName]: '__link',
                        [backlink.parentSortKeyName]: fwdSKVal
                    }
                }));
                // Delete the back-reference record itself
                await getDocClient().send(new DeleteCommand({
                    TableName: metadata.tableName,
                    Key: {
                        [metadata.hashKeyName]: backlink[metadata.hashKeyName],
                        [metadata.sortKeyName!]: backlink[metadata.sortKeyName!]
                    }
                }));
            }));
        }

        await getDocClient().send(new DeleteCommand({
            TableName: metadata.tableName,
            Key: key
        }));
    }

    async loadLinks() {
        const parentMetadata = this.getMetadata();
        const parentKey = this.getKey();
        const links: LinkMetadata[] = (this.constructor.prototype as any)[LINKS_METADATA] || [];

        for (const link of links) {
            if (!link.entityClass) continue;

            const EntityClass = link.entityClass;
            const entityMetadata = (EntityClass as any).__entityMetadata__;
            const fromDbModelMapper = (EntityClass as any)[FROM_DB_MODEL_METADATA];

            const instantiate = (raw: any): BaseEntity => {
                let itemData = raw;
                if (fromDbModelMapper) {
                    itemData = { ...raw, ...(EntityClass as any)[fromDbModelMapper](raw) };
                }
                const instance = new EntityClass();
                Object.assign(instance, itemData);
                return instance;
            };

            const idField = `__${link.propertyKey}ID`;
            const idValue = (this as any)[idField];

            if (idValue != null) {
                // ── Inline path: IDs embedded on the parent item ──
                if (Array.isArray(idValue)) {
                    const loaded = await Promise.all(
                        idValue.map(async (keyObj: any) => {
                            const result = await getDocClient().send(new GetCommand({
                                TableName: entityMetadata.tableName,
                                Key: keyObj
                            }));
                            return result.Item ? instantiate(result.Item) : null;
                        })
                    );
                    (this as any)[link.propertyKey] = loaded.filter(e => e !== null);
                } else {
                    const result = await getDocClient().send(new GetCommand({
                        TableName: entityMetadata.tableName,
                        Key: idValue
                    }));
                    if (result.Item) {
                        (this as any)[link.propertyKey] = instantiate(result.Item);
                    }
                }
            } else if (parentMetadata.sortKeyName) {
                // ── Non-inline path: look up separate link records, then fetch each entity ──
                const parentHKVal = String(parentKey[parentMetadata.hashKeyName]);
                const parentSKVal = String(parentKey[parentMetadata.sortKeyName]);
                const skPrefix = `${encodeLinkSegment(parentHKVal)}#${encodeLinkSegment(parentSKVal)}#${encodeLinkSegment(link.propertyKey)}#`;

                const linkItems = await paginatedQuery({
                    TableName: parentMetadata.tableName,
                    KeyConditionExpression: '#pk = :pkval AND begins_with(#sk, :skprefix)',
                    ExpressionAttributeNames: {
                        '#pk': parentMetadata.hashKeyName,
                        '#sk': parentMetadata.sortKeyName
                    },
                    ExpressionAttributeValues: {
                        ':pkval': '__link',
                        ':skprefix': skPrefix
                    }
                });

                if (linkItems.length === 0) {
                    // For array links with no records, set to empty array instead of leaving undefined
                    if (link.isArray) {
                        (this as any)[link.propertyKey] = [];
                    }
                    continue;
                }

                const loaded = await Promise.all(
                    linkItems.map(async (linkRecord: any) => {
                        const linkedKey: any = {
                            [entityMetadata.hashKeyName]: linkRecord.linkedHashKey
                        };
                        if (entityMetadata.sortKeyName) {
                            linkedKey[entityMetadata.sortKeyName] = linkRecord.linkedSortKey;
                        }
                        const result = await getDocClient().send(new GetCommand({
                            TableName: entityMetadata.tableName,
                            Key: linkedKey
                        }));
                        return result.Item ? instantiate(result.Item) : null;
                    })
                );

                const filtered = loaded.filter(e => e !== null);
                // Use stored link.isArray (from decoration time) to reconstruct the original shape
                (this as any)[link.propertyKey] = link.isArray ? filtered : (filtered[0] ?? null);
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
        // Configure DynamoDB client from the decorator only when explicitly provided.
        if (!docClient && dbClient) {
            BaseEntity.configure(dbClient);
        }

        // Guard against using the reserved '__link' hash key value (used internally for link records).
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
    // Store the mapper method name on the constructor
    target[TO_DB_MODEL_METADATA] = propertyKey;
    return descriptor;
}

export function FromDbModel(target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    // Store the mapper method name on the constructor
    target[FROM_DB_MODEL_METADATA] = propertyKey;
    return descriptor;
}