import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

let _docClient: DynamoDBDocumentClient | undefined;

export function configureClient(dynamoDBClient: DynamoDBClient, documentClientConfig?: any): void {
    _docClient = DynamoDBDocumentClient.from(dynamoDBClient, documentClientConfig);
}

export function isClientConfigured(): boolean {
    return _docClient !== undefined;
}

export function getDocClient(): DynamoDBDocumentClient {
    if (!_docClient) {
        throw new Error(
            'DynamoDB client not configured. Call BaseEntity.configure(new DynamoDBClient({...})) before using the ORM.'
        );
    }
    return _docClient;
}

// Exhaustively pages through a DynamoDB query, returning all matching items.
export async function paginatedQuery(params: any): Promise<any[]> {
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
export function encodeLinkSegment(v: string): string {
    return v.replace(/#/g, '%23');
}
