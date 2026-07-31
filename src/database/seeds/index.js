const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const config = require('../../config/env');
const db = require('../../config/db');

const CUSTO_BCRYPT = 12;

/**
 * Turnos padrao. A quantidade de horarios de cada turno nao e fixa no codigo:
 * estes valores sao apenas a carga inicial, editavel pelo painel administrativo.
 */
const TURNOS = [
    { nome: 'Matutino', slug: 'matutino', icone: 'fa-sun', tema: 'matutino-theme', ordem: 1 },
    {
        nome: 'Vespertino',
        slug: 'vespertino',
        icone: 'fa-cloud-sun',
        tema: 'vespertino-theme',
        ordem: 2,
    },
    { nome: 'Integral', slug: 'integral', icone: 'fa-clock', tema: 'integral-theme', ordem: 3 },
    { nome: 'Noturno', slug: 'noturno', icone: 'fa-moon', tema: 'noturno-theme', ordem: 4 },
];

/**
 * Gera periodos de exatamente 50 minutos a partir de uma hora inicial.
 * `intervalosApos` indica apos qual ordem existe um intervalo (em minutos).
 */
const gerarPeriodos = (horaInicial, quantidade, intervalos = {}) => {
    const [horas, minutos] = horaInicial.split(':').map(Number);
    let cursor = horas * 60 + minutos;
    const periodos = [];

    for (let ordem = 1; ordem <= quantidade; ordem += 1) {
        const inicio = cursor;
        const fim = inicio + 50;
        periodos.push({
            ordem,
            nome: `${ordem}º horário`,
            hora_inicio: minutosParaHora(inicio),
            hora_fim: minutosParaHora(fim),
        });
        cursor = fim + (intervalos[ordem] || 0);
    }

    return periodos;
};

const minutosParaHora = (total) => {
    const horas = String(Math.floor(total / 60)).padStart(2, '0');
    const minutos = String(total % 60).padStart(2, '0');
    return `${horas}:${minutos}`;
};

/**
 * Faixas reais informadas pela instituicao:
 *  Matutino   07:10 - 11:30  (5 periodos, intervalo de 10 min apos o 3o)
 *  Vespertino 13:00 - 18:10  (6 periodos, intervalo de 10 min apos o 3o)
 *  Noturno    18:10 - 22:30  (5 periodos, intervalo de 10 min apos o 3o)
 *  Integral   07:10 - 21:40  (manha + tarde + noite)
 */
const HORARIOS_POR_TURNO = {
    matutino: gerarPeriodos('07:10', 5, { 3: 10 }),
    vespertino: gerarPeriodos('13:00', 6, { 3: 10 }),
    noturno: gerarPeriodos('18:10', 5, { 3: 10 }),
    integral: [
        ...gerarPeriodos('07:10', 5, { 3: 10 }),
        ...gerarPeriodos('13:00', 6, { 3: 10 }).map((p) => ({ ...p, ordem: p.ordem + 5 })),
        ...gerarPeriodos('18:20', 4, {}).map((p) => ({ ...p, ordem: p.ordem + 11 })),
    ].map((periodo) => ({ ...periodo, nome: `${periodo.ordem}º horário` })),
};

/**
 * Campus iniciais da instituicao. Sem ao menos um campus nao e possivel
 * cadastrar locais nem turmas; sao editaveis pelo painel administrativo.
 */
const CAMPUS = [
    { nome: 'Águas Claras', sigla: 'AC' },
    { nome: 'Asa Sul', sigla: 'AS' },
];

const semearCampus = async (cliente) => {
    let criados = 0;
    for (const campus of CAMPUS) {
        const resultado = await cliente.query(
            `
            INSERT INTO campus (nome, sigla, ativo)
            VALUES ($1, $2, TRUE)
            ON CONFLICT (nome) DO NOTHING
            RETURNING id
            `,
            [campus.nome, campus.sigla]
        );
        criados += resultado.rowCount;
    }
    return criados;
};

const semearTurnos = async (cliente) => {
    for (const turno of TURNOS) {
        await cliente.query(
            `
            INSERT INTO turnos (nome, slug, icone, tema_class, ordem, ativo)
            VALUES ($1, $2, $3, $4, $5, TRUE)
            ON CONFLICT (slug) DO UPDATE
               SET nome = EXCLUDED.nome,
                   icone = COALESCE(turnos.icone, EXCLUDED.icone),
                   tema_class = COALESCE(turnos.tema_class, EXCLUDED.tema_class),
                   ordem = EXCLUDED.ordem
            `,
            [turno.nome, turno.slug, turno.icone, turno.tema, turno.ordem]
        );
    }
    return TURNOS.length;
};

const semearHorarios = async (cliente) => {
    let criados = 0;

    for (const [slug, periodos] of Object.entries(HORARIOS_POR_TURNO)) {
        const turno = await cliente.query('SELECT id FROM turnos WHERE slug = $1', [slug]);
        if (turno.rowCount === 0) continue;
        const turnoId = turno.rows[0].id;

        for (const periodo of periodos) {
            // WHERE NOT EXISTS em vez de ON CONFLICT: o gatilho que valida
            // sobreposicao roda antes da resolucao do conflito e recusaria a
            // reinsercao de um periodo identico ja existente.
            const resultado = await cliente.query(
                `
                INSERT INTO horarios_turno (turno_id, nome, ordem, hora_inicio, hora_fim, ativo)
                SELECT $1, $2, $3, $4::time, $5::time, TRUE
                 WHERE NOT EXISTS (
                     SELECT 1 FROM horarios_turno h
                      WHERE h.turno_id = $1
                        AND (h.ordem = $3 OR (h.hora_inicio < $5::time AND $4::time < h.hora_fim))
                 )
                RETURNING id
                `,
                [turnoId, periodo.nome, periodo.ordem, periodo.hora_inicio, periodo.hora_fim]
            );
            criados += resultado.rowCount;
        }
    }

    return criados;
};

const semearPeriodoLetivo = async (cliente) => {
    const agora = new Date();
    const ano = agora.getFullYear();
    const semestre = agora.getMonth() + 1 <= 6 ? 1 : 2;
    const codigo = `${ano}.${semestre}`;

    await cliente.query(
        `
        INSERT INTO periodos_letivos (codigo, ano, semestre, atual, ativo)
        VALUES ($1, $2, $3, TRUE, TRUE)
        ON CONFLICT (codigo) DO NOTHING
        `,
        [codigo, ano, semestre]
    );

    // Garante que exista exatamente um periodo marcado como atual.
    const atual = await cliente.query(
        'SELECT COUNT(*)::int AS total FROM periodos_letivos WHERE atual'
    );
    if (atual.rows[0].total === 0) {
        await cliente.query('UPDATE periodos_letivos SET atual = TRUE WHERE codigo = $1', [codigo]);
    }

    return codigo;
};

const semearAdministrador = async (cliente) => {
    const email = config.admin.email;
    const existente = await cliente.query('SELECT id FROM usuarios WHERE LOWER(email) = $1', [
        email,
    ]);

    const senhaGerada = config.admin.senha || crypto.randomBytes(12).toString('base64url');
    const senhaHash = await bcrypt.hash(senhaGerada, CUSTO_BCRYPT);

    if (existente.rowCount > 0) {
        await cliente.query(`UPDATE usuarios SET perfil = 'admin', ativo = TRUE WHERE id = $1`, [
            existente.rows[0].id,
        ]);
        return { email, criado: false, senha: null };
    }

    await cliente.query(
        `
        INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo)
        VALUES ($1, $2, $3, 'admin', TRUE)
        `,
        [config.admin.nome, email, senhaHash]
    );

    return { email, criado: true, senha: config.admin.senha ? null : senhaGerada };
};

const executar = async () => {
    return db.transacao(async (cliente) => {
        const campus = await semearCampus(cliente);
        const turnos = await semearTurnos(cliente);
        const horarios = await semearHorarios(cliente);
        const periodo = await semearPeriodoLetivo(cliente);
        const admin = await semearAdministrador(cliente);

        return { campus, turnos, horarios, periodo, admin };
    });
};

module.exports = { executar, HORARIOS_POR_TURNO, TURNOS, gerarPeriodos };
