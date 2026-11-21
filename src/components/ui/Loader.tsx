export default function Loader({ label = 'Warming tyres…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="font-mono text-sm tracking-widest text-neon/80 animate-pulse">{label}</div>
    </div>
  );
}
