const fs = require('fs');
const nodemailer = require('nodemailer');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO = 'estado.json';
const API_BASE = 'https://sapl.natal.rn.leg.br';

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO)) {
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  }
  return { proposicoes_vistas: [], ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

async function enviarEmail(novas) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  const porTipo = {};
  novas.forEach(p => {
    const tipo = p.tipo || 'OUTROS';
    if (!porTipo[tipo]) porTipo[tipo] = [];
    porTipo[tipo].push(p);
  });

  const linhas = Object.keys(porTipo).sort().map(tipo => {
    const header = `<tr><td colspan="4" style="padding:10px 8px 4px;background:#f0f4f8;font-weight:bold;color:#1a3a5c;font-size:13px;border-top:2px solid #1a3a5c">${tipo} — ${porTipo[tipo].length} matéria(s)</td></tr>`;
    const rows = porTipo[tipo].map(p =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee"><strong>${p.numero || '-'}/${p.ano || '-'}</strong></td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.tipo || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.data || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.ementa || '-'}</td>
      </tr>`
    ).join('');
    return header + rows;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto">
      <h2 style="color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:8px">
        🏛️ Câmara Municipal de Natal — ${novas.length} nova(s) matéria(s)
      </h2>
      <p style="color:#666">Monitoramento automático — ${new Date().toLocaleString('pt-BR')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#1a3a5c;color:white">
            <th style="padding:10px;text-align:left">Número/Ano</th>
            <th style="padding:10px;text-align:left">Tipo</th>
            <th style="padding:10px;text-align:left">Data</th>
            <th style="padding:10px;text-align:left">Ementa</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Acesse: <a href="https://sapl.natal.rn.leg.br/materia/pesquisar-materia">sapl.natal.rn.leg.br</a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Monitor Natal" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `🏛️ Câmara Natal: ${novas.length} nova(s) matéria(s) — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log(`✅ Email enviado com ${novas.length} matérias novas.`);
}

async function buscarProposicoes() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const pageSize = 100;
  let todasMateria = [];
  let pagina = 1;

  console.log(`🔍 Buscando matérias de ${ano}...`);

  while (true) {
    const url = `${API_BASE}/api/materia/materialegislativa/?ano=${ano}&page=${pagina}&page_size=${pageSize}&ordering=-id`;
    console.log(`📄 Página ${pagina}...`);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    });

    if (!response.ok) {
      console.error(`❌ Erro na API: ${response.status} ${response.statusText}`);
      const texto = await response.text();
      console.error('Resposta:', texto.substring(0, 300));
      break;
    }

    const json = await response.json();
    const lista = json.results || [];
    console.log(`   ${lista.length} matérias recebidas (total: ${json.count})`);

    if (lista.length === 0) break;
    todasMateria = todasMateria.concat(lista);

    // No dia a dia quase tudo já está visto — parar após pág 1 se não há novidades seria ideal,
    // mas como não sabemos isso aqui, limitamos o backlog inicial a 5 páginas (500 matérias)
    if (!json.next || pagina >= 5) break;
    pagina++;
  }

  console.log(`📊 Total coletado: ${todasMateria.length}`);
  return todasMateria;
}

function extrairTipo(p) {
  // SAPL retorna __str__ como "Projeto de Lei nº 42 de 2026"
  // O campo tipo é um ID numérico — extrair nome do __str__
  if (p.__str__) {
    const match = p.__str__.match(/^(.+?)\s+n[°º]/i);
    if (match) return match[1].trim().toUpperCase();
  }
  return 'MATÉRIA LEGISLATIVA';
}

function normalizarProposicao(p) {
  let data = '-';
  if (p.data_apresentacao) {
    const [ano, mes, dia] = p.data_apresentacao.split('-');
    data = `${dia}/${mes}/${ano}`;
  }

  return {
    id: String(p.id),
    tipo: extrairTipo(p),
    numero: String(p.numero || '-'),
    ano: String(p.ano || '-'),
    autor: '-', // SAPL não retorna autor inline — requereria chamada extra por matéria
    data,
    ementa: (p.ementa || '-').substring(0, 200),
  };
}

(async () => {
  console.log('🚀 Iniciando monitor Câmara Municipal de Natal...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  const estado = carregarEstado();
  const idsVistos = new Set(estado.proposicoes_vistas.map(String));

  const materiaRaw = await buscarProposicoes();

  if (materiaRaw.length === 0) {
    console.log('⚠️ Nenhuma matéria encontrada.');
    process.exit(0);
  }

  const materia = materiaRaw.map(normalizarProposicao).filter(p => p.id);
  console.log(`📊 Total normalizado: ${materia.length}`);

  const novas = materia.filter(p => !idsVistos.has(p.id));
  console.log(`🆕 Matérias novas: ${novas.length}`);

  if (novas.length > 0) {
    novas.sort((a, b) => {
      if (a.tipo < b.tipo) return -1;
      if (a.tipo > b.tipo) return 1;
      return (parseInt(b.numero) || 0) - (parseInt(a.numero) || 0);
    });
    await enviarEmail(novas);
    novas.forEach(p => idsVistos.add(p.id));
    estado.proposicoes_vistas = Array.from(idsVistos);
    estado.ultima_execucao = new Date().toISOString();
    salvarEstado(estado);
  } else {
    console.log('✅ Sem novidades. Nada a enviar.');
    estado.ultima_execucao = new Date().toISOString();
    salvarEstado(estado);
  }
})();
