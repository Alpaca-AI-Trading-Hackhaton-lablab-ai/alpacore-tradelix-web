import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TradingDashboard } from "./components/TradingDashboard";

const queryClient = new QueryClient();

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<TradingDashboard />
		</QueryClientProvider>
	);
}
