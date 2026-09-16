import { AppearanceProvider } from './appearance/AppearanceProvider';

export default function App() {
  return (
    <AppearanceProvider>
      <div className="flex min-h-screen items-center justify-center text-app-text">
        <p>Прототип Galley Desk</p>
      </div>
    </AppearanceProvider>
  );
}
