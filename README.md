# orm-dynamodb

[![npm version](https://img.shields.io/npm/v/orm-dynamodb.svg)](https://www.npmjs.com/package/orm-dynamodb)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Lightweight TypeScript decorators for modeling DynamoDB items as classes.

## ✨ Features

- 🎯 **Type-safe decorators** for DynamoDB entities with full TypeScript support
- 🔗 **Entity relationships** with `@Link` decorator and automatic link loading
- 🔄 **Custom serialization** with `@ToDbModel` and `@FromDbModel` transformers
- ⏰ **Automatic timestamps** for `createdAt` and `updatedAt`
- 🛠️ **Intuitive API** with `save()`, `update()`, `delete()`, `get()`, and `query()` methods
- 🚀 **Zero configuration** - works out of the box with AWS SDK v3
- 📦 **Tiny footprint** - lightweight with minimal dependencies

## 📦 Install

```bash
npm install orm-dynamodb
```

**Dependencies:** `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`

### TypeScript Configuration

Enable decorators in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## 🚀 Quick Start

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BaseEntity,
  Entity,
  FromDbModel,
  HashKeyValue,
  Link,
  SortKeyValue,
  ToDbModel
} from 'orm-dynamodb';

BaseEntity.configure(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

@Entity('content', 'pk', 'sk')
class Author extends BaseEntity {
  @HashKeyValue
  get hashKey() {
    return 'AUTHOR';
  }

  @SortKeyValue
  get sortKey() {
    return this.authorId;
  }

  authorId: string;
  displayName: string;

  constructor(authorId: string = '', displayName: string = '') {
    super();
    this.authorId = authorId;
    this.displayName = displayName;
  }
}

@Entity('content', 'pk', 'sk')
class Post extends BaseEntity {
  @HashKeyValue
  get hashKey() {
    return 'POST';
  }

  @SortKeyValue
  get sortKey() {
    return this.slug;
  }

  slug: string;
  title: string;
  publishedAt: Date | null;

  @Link(Author)
  author: Author | undefined;

  constructor(slug: string = '', title: string = '', publishedAt: Date | null = null) {
    super();
    this.slug = slug;
    this.title = title;
    this.publishedAt = publishedAt;
  }

  @ToDbModel
  static toDbModel(post: Post) {
    return {
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null
    };
  }

  @FromDbModel
  static fromDbModel(item: { publishedAt?: string | null }) {
    return {
      publishedAt: item.publishedAt ? new Date(item.publishedAt) : null
    };
  }
}

async function run() {
  const post = new Post('decorators-with-dynamodb', 'Decorators With DynamoDB', new Date());
  post.author = new Author('ada-lovelace', 'Ada Lovelace');

  await post.save();

  const loaded = await Post.get('decorators-with-dynamodb');
  await loaded?.loadLinks();

  console.log(loaded?.author?.displayName);
}
```

## 📚 API

### Decorators & Classes

- **`BaseEntity`** - Base class for all entities with CRUD operations
- **`@Entity(tableName, hashKey, sortKey)`** - Marks a class as a DynamoDB entity
- **`@HashKeyValue`** - Defines the hash key value getter
- **`@SortKeyValue`** - Defines the sort key value getter
- **`@Link(EntityClass)`** - Creates a reference to another entity
- **`@ToDbModel`** - Custom serialization when writing to DynamoDB
- **`@FromDbModel`** - Custom deserialization when reading from DynamoDB

### Core Methods

**Instance Methods:**
- `save()` - Insert or update the entity
- `update()` - Partial update of the entity
- `delete()` - Remove the entity from DynamoDB
- `loadLinks()` - Load all linked entities

**Static Methods:**
- `get(sortKeyValue)` - Retrieve a single entity by sort key
- `query(options)` - Query entities in the partition
- `configure(client)` - Set the DynamoDB client globally

### Features

- ✅ Explicit DynamoDB client configuration via `BaseEntity.configure(...)` or `@Entity(..., dbClient)`
- ✅ Automatic `createdAt` and `updatedAt` timestamp management
- ✅ Type-safe entity relationships with lazy loading
- ✅ Custom transformation between domain models and DynamoDB items

## 🛠️ Development

Install dependencies:

```bash
pnpm install
```

Build the package:

```bash
pnpm build
```

Run the local example:

```bash
pnpm exec tsx examples.ts
```

Check what will be published:

```bash
npm run pack:check
```

## 📝 License

Apache-2.0

## ⚠️ Important Notes

- Static lookups assume the hash key can be derived from a default-constructed instance
- Query helpers operate within a single partition key value
- Link loading issues individual `GetCommand` calls per linked record
- This is a lightweight utility, not a schema or migration system

## 📖 Examples

See [examples.ts](./examples.ts) for examples.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
