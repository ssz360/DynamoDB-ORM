import 'dotenv/config';
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { BaseEntity } from '../DynamiteORM';

const tableName = process.env.TEST_TABLE_NAME || 'test-dynamite-orm';

// Configure DynamoDB client for tests
const client = new DynamoDBClient({
    region: process.env.TEST_AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.TEST_AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.TEST_AWS_SECRET_ACCESS_KEY!
    }
});

// Configure BaseEntity with test client
BaseEntity.configure(client);

// Helper to check if table exists
async function tableExists(name: string): Promise<boolean> {
    try {
        await client.send(new DescribeTableCommand({ TableName: name }));
        return true;
    } catch {
        return false;
    }
}

// Create test table before all tests
export async function setupTestTable() {
    const exists = await tableExists(tableName);
    
    if (!exists) {
        await client.send(new CreateTableCommand({
            TableName: tableName,
            KeySchema: [
                { AttributeName: 'hKey', KeyType: 'HASH' },
                { AttributeName: 'sKey', KeyType: 'RANGE' }
            ],
            AttributeDefinitions: [
                { AttributeName: 'hKey', AttributeType: 'S' },
                { AttributeName: 'sKey', AttributeType: 'S' }
            ],
            BillingMode: 'PAY_PER_REQUEST'
        }));

        // Wait for table to be active
        let ready = false;
        while (!ready) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
                ready = result.Table?.TableStatus === 'ACTIVE';
            } catch {
                // Table not ready yet
            }
        }
    }
}

// Cleanup test table after all tests (optional - comment out to keep table)
export async function cleanupTestTable() {
    // Uncomment to delete table after tests
    // const exists = await tableExists(tableName);
    // if (exists) {
    //     await client.send(new DeleteTableCommand({ TableName: tableName }));
    // }
}

// Run setup before tests start
beforeAll(async () => {
    await setupTestTable();
});

// Optionally cleanup after all tests
// afterAll(async () => {
//     await cleanupTestTable();
// });

export { tableName };
