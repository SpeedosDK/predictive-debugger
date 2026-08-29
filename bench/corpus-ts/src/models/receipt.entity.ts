import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "receipts" })
export class Receipt {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column({ type: "varchar", length: 32 })
    reference!: string;

    @Column({ type: "numeric" })
    amount!: number;

    // A nullable column arrives as null, never undefined, so the property is
    // typed and compared as null throughout.
    @Column({ type: "timestamptz", nullable: true })
    refundedAt: Date | null = null;

    @Column({ type: "text", nullable: true })
    memo: string | null = null;

    isRefunded(): boolean {
        return this.refundedAt !== null;
    }

    describe(): string {
        const suffix = this.memo === null ? "" : ` (${this.memo})`;
        return `${this.reference}: ${this.amount}${suffix}`;
    }
}
