import { useState } from "react";
import { AddServiceForm } from "../components/AddServiceForm";
import { EventDetail } from "../components/EventDetail";
import { EventLog } from "../components/EventLog";
import { ServiceCard } from "../components/ServiceCard";
import { useBridge } from "../hooks/useBridge";
import { type WebhookEventPayload, useEvents } from "../hooks/useEvents";
import { useServices } from "../hooks/useServices";

export function Dashboard() {
	const {
		services,
		loading: servicesLoading,
		addService,
		removeService,
		toggleService,
	} = useServices();
	const { events, replayEvent } = useEvents();
	const { isConnected, getError } = useBridge();

	const [showAddForm, setShowAddForm] = useState(false);
	const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

	const selectedEvent = selectedEventId
		? (events.find((e) => e.id === selectedEventId) ?? null)
		: null;

	const handleAddService = async (name: string, port: number, path: string) => {
		await addService(name, port, path);
		setShowAddForm(false);
	};

	return (
		<div className="flex flex-col gap-4 h-full">
			{/* Services Section */}
			<section>
				<div className="flex items-center justify-between mb-3">
					<h2 className="text-lg font-semibold text-white">Services</h2>
					{!showAddForm && (
						<button
							type="button"
							onClick={() => setShowAddForm(true)}
							className="px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-medium transition-colors"
						>
							+ Add Service
						</button>
					)}
				</div>

				{showAddForm && (
					<div className="mb-3">
						<AddServiceForm onAdd={handleAddService} onCancel={() => setShowAddForm(false)} />
					</div>
				)}

				{servicesLoading ? (
					<div className="text-gray-500 text-sm py-4 text-center">Loading services...</div>
				) : services.length === 0 && !showAddForm ? (
					<div className="text-center py-8 bg-gray-800/50 rounded-lg border border-gray-700 border-dashed">
						<p className="text-gray-400 text-sm">No services configured yet</p>
						<p className="text-gray-500 text-xs mt-1">Add a service to start receiving webhooks</p>
						<button
							type="button"
							onClick={() => setShowAddForm(true)}
							className="mt-3 px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-medium transition-colors"
						>
							+ Add Your First Service
						</button>
					</div>
				) : (
					<div className="space-y-2">
						{services.map((service) => (
							<ServiceCard
								key={service.id}
								service={service}
								connected={isConnected(service.id)}
								error={getError(service.id)}
								onToggle={toggleService}
								onRemove={removeService}
							/>
						))}
					</div>
				)}
			</section>

			{/* Live Events Section */}
			<section className="flex-1 min-h-0 flex flex-col">
				<div className="flex items-center justify-between mb-3">
					<h2 className="text-lg font-semibold text-white">Live Events</h2>
					{events.length > 0 && (
						<span className="text-xs text-gray-500">
							{events.length} event{events.length !== 1 ? "s" : ""}
						</span>
					)}
				</div>

				<div className="flex-1 min-h-0 bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
					<EventLog
						events={events}
						selectedEventId={selectedEventId}
						onSelect={setSelectedEventId}
					/>
				</div>
			</section>

			{/* Event Detail Panel */}
			{selectedEvent && (
				<section>
					<EventDetail event={selectedEvent} onClose={() => setSelectedEventId(null)} />
				</section>
			)}
		</div>
	);
}
