---
title: "NestJS Best Practices & Infra Guide"
impact: high
impactDescription: "NestJS provides structure but misuse of DI, modules, and decorators creates untestable, tightly coupled code"
tags: [node, nestjs, typescript, di, enterprise, backend]
---

# NestJS — Senior Engineer's Guide

> NestJS gives you guardrails. Don't fight the framework — lean into the opinions.

## When to Choose

**Choose when:** Large team (5+), enterprise requirements, need enforced architecture, strong TypeScript-first.
**Avoid when:** Quick script/prototype, small microservice, team unfamiliar with DI/decorators.
**Honest trade-off:** Higher learning curve and boilerplate than Express. Worth it at scale.

## Project Structure

```
src/
├── main.ts                      # Bootstrap
├── app.module.ts                # Root module
├── common/
│   ├── filters/exception.filter.ts
│   ├── guards/auth.guard.ts
│   ├── interceptors/logging.interceptor.ts
│   ├── pipes/validation.pipe.ts
│   └── decorators/current-user.decorator.ts
├── modules/
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.controller.ts    # HTTP layer only
│   │   ├── users.service.ts       # Business logic
│   │   ├── users.repository.ts    # Data access
│   │   ├── dto/create-user.dto.ts
│   │   └── entities/user.entity.ts
│   └── auth/
│       ├── auth.module.ts
│       ├── auth.controller.ts
│       ├── auth.service.ts
│       └── strategies/jwt.strategy.ts
└── config/
    ├── config.module.ts
    └── database.config.ts
```

## Best Practices

### Keep Controllers Thin (Impact: high)

#### Incorrect
```typescript
@Controller("users")
export class UsersController {
  @Post()
  async create(@Body() body: any) {
    // Business logic in controller!
    const existing = await this.usersRepo.findByEmail(body.email)
    if (existing) throw new ConflictException()
    const hashed = await bcrypt.hash(body.password, 12)
    return this.usersRepo.create({ ...body, password: hashed })
  }
}
```

#### Correct
```typescript
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto)  // Controller only handles HTTP
  }
}

// Service has all business logic — testable without HTTP
@Injectable()
export class UsersService {
  constructor(private readonly usersRepo: UsersRepository) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepo.findByEmail(dto.email)
    if (existing) throw new ConflictException("EMAIL_TAKEN")
    dto.password = await bcrypt.hash(dto.password, 12)
    return this.usersRepo.create(dto)
  }
}
```

### DTO Validation (Impact: high)

#### Incorrect
```typescript
@Post()
async create(@Body() body: any) {  // No type safety, no validation
  await this.service.create(body)
}
```

#### Correct
```typescript
// DTO with class-validator decorators
export class CreateUserDto {
  @IsEmail()
  @MaxLength(255)
  email: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string

  @IsString()
  @MinLength(8)
  password: string
}

// Global validation pipe in main.ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,          // Strip unknown properties
  forbidNonWhitelisted: true,  // Reject unknown properties
  transform: true,
}))
```

### Module Boundaries (Impact: medium)

#### Incorrect
```typescript
// Importing repository directly from another module
import { UsersRepository } from "../users/users.repository"

@Injectable()
export class OrdersService {
  constructor(private usersRepo: UsersRepository) {}  // Tight coupling!
}
```

#### Correct
```typescript
// Expose only the service, not internals
@Module({
  providers: [UsersService, UsersRepository],
  exports: [UsersService],  // Only service is public
})
export class UsersModule {}

// Other modules use the service
@Injectable()
export class OrdersService {
  constructor(private usersService: UsersService) {}  // Clean dependency
}
```

## Infrastructure & Deployment

### Dockerfile
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN adduser -u 1001 -D app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json .
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### Performance Tips
- Enable Fastify adapter: `NestFactory.create(AppModule, new FastifyAdapter())`
- Use `@nestjs/cache-manager` with Redis for response caching
- Lazy-load modules: `LazyModuleLoader` for rarely-used features

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Circular dependency | Runtime crash, cryptic error | `forwardRef()` or restructure modules |
| Business logic in controller | Untestable, duplicated code | Move to service layer |
| No whitelist on ValidationPipe | Extra fields pass through | `whitelist: true, forbidNonWhitelisted: true` |
| Importing repo across modules | Tight coupling | Export only services |
| Synchronous bootstrap | Slow cold start | Lazy-load non-critical modules |
