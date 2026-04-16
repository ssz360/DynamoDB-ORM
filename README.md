# orm-dynamodb

Lightweight TypeScript decorators for modeling DynamoDB items as classes.

## Install

```bash
npm install orm-dynamodb
```

The package depends on `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`.

Your TypeScript config must enable decorators:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Quick Start

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

## API

The package exports:

- `BaseEntity`
- `Entity`
- `HashKeyValue`
- `SortKeyValue`
- `Link`
- `ToDbModel`
- `FromDbModel`

Core capabilities:

- explicit DynamoDB client configuration via `BaseEntity.configure(...)` or `@Entity(..., dbClient)`
- `save()`, `update()`, and `delete()` instance methods
- `get()`, `query()`, and common query helpers on the entity class
- linked entity references with `@Link(...)` and `loadLinks()`
- custom read/write mapping with `@ToDbModel` and `@FromDbModel`
- automatic `createdAt` and `updatedAt` timestamps

## Local Development

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

## Publish

Make sure the package name in `package.json` is the one you want to publish and is available on npm, then:

```bash
npm login
npm publish
```

If you rename the package, update the import path in this README to match.

## Notes

- Static lookups assume the hash key can be derived from a default-constructed instance.
- Query helpers all operate within a single partition key value.
- Link loading currently issues individual `GetCommand` calls per linked record.
- This is a lightweight utility, not a schema or migration system.

See [examples.ts](./examples.ts) for a fuller usage example.
