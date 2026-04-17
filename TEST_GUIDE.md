# dynamoDbORMteORM Test Suite

## Overview

Comprehensive test suite for dynamoDbORMteORM using Vitest and real DynamoDB connection (no mocks).

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure test database:**
   
   Update `.env` file with your test DynamoDB credentials:
   ```env
   TEST_TABLE_NAME=test-dynamoDbORMte-orm
   TEST_AWS_REGION=us-east-1
   TEST_AWS_ACCESS_KEY_ID=your_access_key
   TEST_AWS_SECRET_ACCESS_KEY=your_secret_key
   ```

3. **Table creation:**
   
   The test suite automatically creates the test table if it doesn't exist.
   Table schema:
   - Table Name: `test-dynamoDbORMte-orm` (configurable via env)
   - Hash Key: `hKey` (String)
   - Sort Key: `sKey` (String)
   - Billing Mode: PAY_PER_REQUEST

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui
```

## Test Coverage

### 1. Basic CRUD Operations
- Create and save items
- Update items
- Delete items
- Query items with various conditions

### 2. Inline Links (@LinkObject with inline: true)
- Save and load inline linked objects
- Handle null inline links
- Store link IDs directly on parent item

### 3. Non-Inline Links (Separate Link Records)
- Save and load non-inline linked objects
- **Issue 1**: Cleanup stale link records when setting to null
- Replace links when changing to different child
- Uses separate records with `hKey='__link'`

### 4. Link Arrays (@LinkArray)
- Save and load arrays of linked items
- **Issue 1**: Handle splice operations and cleanup stale records
- Handle clearing entire arrays
- Multiple link records per parent

### 5. Issue 2: Sort Key Validation
- Validates that non-inline links require entities with sort keys
- Throws descriptive error when sort key is missing

### 6. Issue 5: Delete Cascade
- Cleanup link records when deleting parent entity
- Prevents orphan link records in database

### 7. Issue 6: Hash Encoding in Sort Keys
- Handle `#` characters in hash and sort keys
- Properly encode segments to avoid prefix ambiguity
- Test with multiple `#` characters in linked item keys

### 8. Issue 7: Reserved Hash Key Value
- Prevent use of reserved `'__link'` hash key value
- Throws error during entity decoration

### 9. ToDbModel and FromDbModel Transformers
- Apply ToDbModel transformation on save
- Apply FromDbModel transformation on load
- Test with Date serialization/deserialization

### 10. Query Operations
- Query all items
- Query with equals condition
- Query with greater than condition
- Query with less than condition
- Query with starts with condition (prefix)
- Query with limit
- Query between range

### 11. Error Handling
- Return null for non-existent items
- Handle empty query results
- Graceful error messages

### 12. Issue 4: Stale __propertyID Cleanup
- Ensure `__propertyID` fields are not persisted for non-inline links
- Verify cleanup after loadLinks() followed by save()

## Test Data Cleanup

Each test suite has `afterEach` hooks that clean up test data by hash key prefix. This ensures test isolation and prevents data contamination between tests.

## Known Considerations

1. **Table Persistence**: The test table is NOT automatically deleted after tests complete. To enable cleanup, uncomment the `afterAll` hook in `tests/setup.ts`.

2. **AWS Costs**: Tests use real DynamoDB with PAY_PER_REQUEST billing. Costs should be minimal for test runs but consider using DynamoDB Local for extensive testing.

3. **Data Isolation**: Tests use unique hash key prefixes (e.g., `ITEM`, `CHILD`, `PARENT_ARRAY`, `__link`) to isolate test data.

4. **Test Duration**: Full test suite takes approximately 60-75 seconds to complete due to real DynamoDB I/O.

## Troubleshooting

### Table Already Exists Error
If you get a table creation error, ensure the table schema matches:
- Hash Key: `hKey` (String)
- Sort Key: `sKey` (String)

### Permission Errors
Ensure your AWS credentials have permissions for:
- `dynamodb:CreateTable`
- `dynamodb:DescribeTable`
- `dynamodb:PutItem`
- `dynamodb:GetItem`
- `dynamodb:Query`
- `dynamodb:Scan`
- `dynamodb:DeleteItem`

### Test Timeouts
If tests timeout:
1. Check network connectivity to AWS
2. Verify credentials are valid
3. Increase timeout in `vitest.config.ts`

## Architecture Insights

### Link Record Structure
Non-inline link records use this structure:
```typescript
{
  hKey: '__link',
  sKey: '{parentHK}#{parentSK}#{property}#{linkedHK}#{linkedSK}',
  linkedHashKey: string,
  linkedSortKey: string,
  isArray: boolean
}
```

Sort key segments are encoded to escape `#` characters (`#` → `%23`) to prevent prefix ambiguity.

### Inline vs Non-Inline
- **Inline** (`LinkObject/LinkArray` with `{ inline: true }`):
  - Stores `__propertyID` field on parent item
  - Single DB write to parent
  - Best for simple references
  
- **Non-Inline** (default for arrays):
  - Separate link records with `hKey='__link'`
  - Multiple DB writes (parent + link records)
  - Handles large arrays and complex relationships
  - Requires parent to have a sort key

## CI/CD Integration

For CI/CD pipelines, consider:
1. Using DynamoDB Local instead of real AWS
2. Setting shorter timeouts
3. Parallel test execution (not currently configured)
4. Automated table cleanup

Example GitHub Actions:
```yaml
- name: Run tests
  env:
    TEST_AWS_REGION: us-east-1
    TEST_AWS_ACCESS_KEY_ID: ${{ secrets.TEST_AWS_ACCESS_KEY_ID }}
    TEST_AWS_SECRET_ACCESS_KEY: ${{ secrets.TEST_AWS_SECRET_ACCESS_KEY }}
  run: npm test
```
