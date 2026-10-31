/** The longest tag the list pill takes. */
export const BOT_TAG_MAX = 24;

export interface BotTagArea {
  area: string;
  tags: readonly string[];
}

/** Role tags offered when a bot gets its tag, grouped by area. The tag stays free text: these are suggestions. */
export const BOT_TAG_AREAS: readonly BotTagArea[] = [
  { area: "Gestão e Operações", tags: [
    "Gerente Operacional", "Diretor Geral", "CEO", "Sócio", "Coordenador", "Gerente de Projetos",
    "Product Manager", "Product Owner", "Scrum Master", "Analista de Processos", "Operações", "Planejamento",
  ] },
  { area: "Financeiro", tags: [
    "Financeiro", "Diretor Financeiro", "Analista Financeiro", "Contador", "Controller", "Tesouraria",
    "Contas a Pagar", "Contas a Receber", "Faturamento", "Cobrança", "Fiscal", "Orçamento", "Auditoria", "Investimentos",
  ] },
  { area: "Tecnologia", tags: [
    "Desenvolvedor Front-end", "Desenvolvedor Back-end", "Desenvolvedor Full Stack", "Desenvolvedor Mobile",
    "Engenheiro de Software", "Arquiteto de Software", "Tech Lead", "CTO", "DevOps", "QA e Testes",
    "Segurança da Informação", "Suporte Técnico", "Infraestrutura", "Banco de Dados", "Automação", "Integrações",
    "No-code",
  ] },
  { area: "Dados e IA", tags: [
    "Dados", "Analista de Dados", "Cientista de Dados", "Engenheiro de Dados", "BI", "Engenheiro de IA",
    "Prompt Engineer", "Relatórios",
  ] },
  { area: "Design", tags: [
    "Designer", "Diretor de Arte", "Designer Gráfico", "UI Designer", "UX Designer", "Designer de Produto",
    "Motion Designer", "Ilustrador", "Branding", "Designer de Embalagem", "Diagramação", "Apresentações", "3D",
  ] },
  { area: "Audiovisual", tags: [
    "Editor de Vídeo", "Videomaker", "Fotógrafo", "Colorista", "Roteirista", "Animação", "Pós-produção",
    "Sound Design", "Locutor", "Podcast", "Thumbnails",
  ] },
  { area: "Conteúdo", tags: [
    "Copywriter", "Redator", "Revisor", "Social Media", "Estrategista de Conteúdo", "Criador de Conteúdo",
    "SEO", "Newsletter", "Tradutor", "Ghostwriter", "Jornalista", "Assessoria de Imprensa", "Community Manager",
    "UX Writer",
  ] },
  { area: "Marketing", tags: [
    "Marketing", "Gerente de Marketing", "Tráfego Pago", "Gestor de Tráfego", "Growth", "Performance", "CRM",
    "E-mail Marketing", "Marketing de Produto", "Lançamentos", "Afiliados", "Influenciadores", "Eventos",
    "Planejamento de Mídia",
  ] },
  { area: "Vendas", tags: [
    "Vendas", "Comercial", "SDR", "Closer", "Executivo de Contas", "Pré-vendas", "Inside Sales", "Key Account",
    "Propostas", "Parcerias", "E-commerce", "Marketplace", "Customer Success",
  ] },
  { area: "Atendimento", tags: [
    "Atendimento", "Suporte ao Cliente", "SAC", "Pós-venda", "Ouvidoria", "Recepção", "Agendamento", "Relacionamento",
  ] },
  { area: "Pessoas e RH", tags: [
    "RH", "Recrutamento", "Departamento Pessoal", "Folha de Pagamento", "Treinamento", "Cultura", "Endomarketing",
    "Onboarding",
  ] },
  { area: "Jurídico", tags: [
    "Jurídico", "Advogado", "Contratos", "Compliance", "LGPD", "Trabalhista", "Tributário",
    "Propriedade Intelectual", "Societário",
  ] },
  { area: "Pesquisa e Estratégia", tags: [
    "Pesquisa", "Pesquisador", "Pesquisa de Mercado", "UX Research", "Estrategista", "Planejamento Estratégico",
    "Inteligência de Mercado", "Consultor", "Analista de Negócios", "Tendências",
  ] },
  { area: "Administrativo", tags: [
    "Administrativo", "Assistente Executivo", "Assistente Pessoal", "Secretariado", "Agenda", "Documentos", "Viagens",
    "Compras", "Logística", "Estoque",
  ] },
  { area: "Educação", tags: [
    "Professor", "Tutor", "Designer Instrucional", "Cursos", "Mentoria",
  ] },
] as const;

/** What Jev reads to suggest a tag. Never the bot's instructions: they can hold a client's private context. */
export interface BotTagSuggestionRequest {
  name?: string;
  title?: string;
  description?: string;
}

/** Null while the bot says nothing about its job: a name alone is no clue. */
export function tagSuggestionRequest({ name, title, description }: BotTagSuggestionRequest): BotTagSuggestionRequest | null {
  return title?.trim() || description?.trim() ? { name, title, description } : null;
}

/** What a tag search compares: no accents, case, spaces, hyphens, dots or underscores. */
export function tagSearchKey(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s._()-]+/g, "");
}

/** The tag the list stores: one line, no outer spaces. Empty means no tag. */
export function cleanBotTag(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
