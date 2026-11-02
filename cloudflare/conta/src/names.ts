const RESERVED = new Set(
  ("www app apps api conta contas account accounts login logout entrar sair auth oauth sso admin root painel " +
    "legal mail email smtp imap pop ftp status docs doc blog help ajuda suporte support " +
    "billing pagamento pagamentos pay checkout cdn static assets img media nordus google apple microsoft " +
    "cloud dev staging prod producao teste test demo ns ns1 ns2 mx vpn portal site home loja shop store " +
    "servidor servidores server servers meu minha novo ativar instalar install download downloads release releases").split(" "),
);

// A chosen name sits under the brand's domain, so names that read like a sign-in or payment page are refused.
const MISLEADING = ["login", "senha", "password", "verif", "secure", "segur", "google", "apple", "microsoft", "banco", "bank", "paypal", "pix", "fatura", "invoice", "suporte", "support", "oficial", "official", "nordus"];

export type NameProblem = "formato" | "reservado" | "ocupado";

export function normalizeName(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

export function nameProblem(name: string): Exclude<NameProblem, "ocupado"> | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/.test(name) || name.includes("--")) return "formato";
  if (RESERVED.has(name) || MISLEADING.some((word) => name.includes(word))) return "reservado";
  return null;
}

/** A suggestion from the machine's name: "Avery's MacBook Pro" becomes "gabriels-macbook-pro". */
export function suggestName(machine: string): string {
  const base = machine
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  if (base.length >= 3 && !nameProblem(base)) return base;
  return `bots-${Math.floor(1000 + Math.random() * 9000)}`;
}
