import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Customer } from "./customer.entity";

@Entity({ name: "invoices" })
export class Invoice {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column({ type: "varchar", length: 32 })
    reference!: string;

    @Column({ type: "numeric" })
    amount!: number;

    @Column({ type: "varchar", length: 3, default: "DKK" })
    currency!: string;

    @Column({ type: "timestamptz", nullable: true })
    settledAt?: Date;

    @Column({ type: "text", nullable: true })
    note?: string;

    @ManyToOne(() => Customer, (customer) => customer.invoices)
    customer!: Customer;

    isSettled(): boolean {
        return this.settledAt !== undefined;
    }

    describe(): string {
        const suffix = this.note === undefined ? "" : ` (${this.note})`;
        return `${this.reference}: ${this.amount} ${this.currency}${suffix}`;
    }
}
