import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BaseEntity, Entity, FromDbModel, HashKeyValue, Link, SortKeyValue, ToDbModel } from "./DynamiteORM";



@Entity('test', 'hKey', 'sKey') // or @Entity('test', 'hKey', 'sKey', new DynamoDBClient({...}))
class Wheel extends BaseEntity {
    @HashKeyValue
    get hashKey() { return `WHEEL`; }
    @SortKeyValue
    get sortKey() { return `${this.wheelID}`; }

    wheelID: number;

    constructor(wheelID: number = 0) {
        super();
        this.wheelID = wheelID;
    }
}

@Entity('test', 'hKey', 'sKey')
class Car extends BaseEntity {
    @HashKeyValue
    get hashKey() { return 'Car'; }
    @SortKeyValue
    get sortKey() { return this.carID.toString(); }

    carID: number;
    make: string;
    model: string;
    year: number;
    @Link(Wheel)
    wheels: Wheel[] | undefined;

    constructor(carID: number = 0, make: string = '', model: string = '', year: number = 0) {
        super();
        this.carID = carID;
        this.make = make;
        this.model = model;
        this.year = year;
    }

    @ToDbModel
    static toDBModelMapper(instance: Car) {
        // Custom transformation before saving to DB
        return {
            ...instance,
            updatedAt: new Date().toISOString(),
            createdAt: instance.createdAt ? instance.createdAt.toISOString() : new Date().toISOString(),
        };
    }

    @FromDbModel
    static fromDBModelMapper(dbModel: any): Car {
        // Custom transformation after loading from DB
        return {
            ...dbModel,
            updatedAt: new Date(dbModel.updatedAt),
            createdAt: new Date(dbModel.createdAt),
        };
    }
}


// Usage examples:
async function examples() {
    // ===== CONFIGURATION (REQUIRED - must be called first) =====
    // Configure with custom region and credentials
    BaseEntity.configure(
        new DynamoDBClient({
            region: 'us-east-1',
            credentials: {
                accessKeyId: '...',
                secretAccessKey: '...'
            }
        })
    );

    // Or configure for local DynamoDB
    // BaseEntity.configure(
    //     new DynamoDBClient({
    //         endpoint: 'http://localhost:8000',
    //         region: 'local'
    //     })
    // );

    // Or use default AWS credentials (from environment, IAM role, etc.)
    // BaseEntity.configure(new DynamoDBClient({ region: 'us-east-1' }));

    // ===== BASIC CRUD OPERATIONS =====

    // Create and save a car
    const car = new Car(123, 'Toyota', 'Camry', 2024);
    await car.save();

    // Get single item by sort key (hash key is automatic)
    const retrievedCar = await Car.get('123');

    // Update specific fields
    if (retrievedCar) {
        await retrievedCar.update({ make: 'Honda', model: 'Accord' });
    }

    // Delete
    if (retrievedCar) {
        await retrievedCar.delete();
    }

    // ===== LINKED ENTITIES (@Link decorator) =====

    // Create car with linked wheels
    const carWithWheels = new Car(456, 'Tesla', 'Model 3', 2024);
    carWithWheels.wheels = [
        new Wheel(1),
        new Wheel(2),
        new Wheel(3),
        new Wheel(4)
    ];

    // Save car - wheels are automatically saved first (cascade save)
    await carWithWheels.save();

    // Retrieve car (wheels will be IDs only)
    const loadedCar = await Car.get('456');
    console.log(loadedCar?.wheels); // undefined - only wheelsID exists

    // Load linked entities
    if (loadedCar) {
        await loadedCar.loadLinks();
        console.log(loadedCar.wheels); // Now populated with Wheel instances
    }

    // ===== QUERY EXAMPLES =====

    // Get all cars
    const allCars = await Car.queryAll(10);

    // Query with sort key conditions
    const specificCars = await Car.queryEquals('123');
    const carsInRange = await Car.queryBetween('100', '200');
    const newerCars = await Car.queryGreaterThan('400');
    const olderCars = await Car.queryLessThan('500');
    const carsWithPrefix = await Car.queryStartsWith('1');

    // Advanced query with options
    const customQuery = await Car.query({
        sortKeyCondition: { type: 'greaterThan', value: '100' },
        limit: 20,
        scanIndexForward: false // descending order
    });

    // Query and load links for all results
    const carsWithWheels = await Car.queryAll();
    await Promise.all(carsWithWheels.map(c => c.loadLinks()));
}

examples().then(() => console.log("test completed"));