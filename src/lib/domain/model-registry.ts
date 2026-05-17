import { cloneTelemetry, normalizeModelKey, type ModelTelemetry } from './model-telemetry';

export class ModelRegistry {
	private readonly models = new Map<string, ModelTelemetry>();

	upsert(model: ModelTelemetry): ModelTelemetry {
		this.models.set(this.resolveKey(model.id, model.name), cloneTelemetry(model));
		return model;
	}

	remove(identifier: string): boolean {
		return this.models.delete(this.resolveKey(identifier));
	}

	get(identifier: string): ModelTelemetry | undefined {
		const current = this.models.get(this.resolveKey(identifier));
		return current ? cloneTelemetry(current) : undefined;
	}

	list(): ModelTelemetry[] {
		return [...this.models.values()]
			.map((model) => cloneTelemetry(model))
			.sort((left, right) => left.name.localeCompare(right.name, 'es'));
	}

	clear(): void {
		this.models.clear();
	}

	count(): number {
		return this.models.size;
	}

	private resolveKey(identifier: string, fallbackName = identifier): string {
		const candidate = identifier.trim() || fallbackName.trim();
		return normalizeModelKey(candidate);
	}
}
