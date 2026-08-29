import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { OrderService } from "../services/order.service";
import type { OrderDto, PageQuery } from "../lib/types";

@Controller("orders")
export class OrderController {
    constructor(private readonly orders: OrderService) {}

    @Get(":id")
    async findOne(@Param("id") id: string): Promise<OrderDto | null> {
        const order = await this.orders.byId(id);
        return order ?? null;
    }

    @Get()
    async list(@Query() query: PageQuery): Promise<OrderDto[]> {
        const page = query.page ?? 0;
        const size = query.size ?? 25;
        return this.orders.page(page, size);
    }

    @Post()
    async create(@Body() body: OrderDto): Promise<OrderDto> {
        return this.orders.create(body);
    }

    @Post(":id/cancel")
    async cancel(@Param("id") id: string): Promise<{ cancelled: boolean }> {
        const order = await this.orders.byId(id);
        if (!order) {
            return { cancelled: false };
        }
        await this.orders.cancel(order.id);
        return { cancelled: true };
    }

    @Get(":id/lines")
    async lines(@Param("id") id: string): Promise<OrderDto["lines"]> {
        const order = await this.orders.byId(id);
        return order?.lines ?? [];
    }

    @Get(":id/total")
    async total(@Param("id") id: string): Promise<number> {
        const order = await this.orders.byId(id);
        if (!order) {
            return 0;
        }
        return order.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    }
}
