const db = require('../database/db');

const ENTIDADES_PERMITIDAS = ['cursos', 'professores', 'disciplinas', 'turmas', 'turnos', 'usuarios'];

const PERMISSOES_POR_TIPO = {
    admin: ENTIDADES_PERMITIDAS,
    coordenador: ['cursos', 'professores', 'disciplinas', 'turmas'],
    nap: ['turmas'],
};

const LABELS_ENTIDADE = {
    cursos: 'Cursos',
    professores: 'Professores',
    disciplinas: 'Disciplinas',
    turmas: 'Turmas',
    turnos: 'Turnos',
    usuarios: 'Usuários',
};

const parseIntSeguro = (valor, fallback) => {
    const n = Number.parseInt(valor, 10);
    return Number.isNaN(n) ? fallback : n;
};

const withBase = (req, target = '/') => {
    const base = req.basePathPrefix || '';
    const normalizedTarget = String(target || '/').startsWith('/')
        ? String(target || '/')
        : `/${String(target || '/')}`;
    return `${base}${normalizedTarget}`;
};

const usuarioPodeAcessarEntidade = (usuario, entidade) => {
    const permissoes = PERMISSOES_POR_TIPO[usuario.tipo] || [];
    return permissoes.includes(entidade);
};

const garantirAcessoEntidade = (res, entidade) => {
    const usuario = res.locals.usuarioLogado;

    if (!ENTIDADES_PERMITIDAS.includes(entidade)) {
        return { ok: false, status: 404, msg: 'Entidade inválida.' };
    }

    if (!usuarioPodeAcessarEntidade(usuario, entidade)) {
        return { ok: false, status: 403, msg: 'Acesso negado para esta área.' };
    }

    return { ok: true };
};

const buildListConfig = (entidade) => {
    if (entidade === 'turmas') {
        return {
            select: `
                SELECT 
                    t.*,
                    c.nome AS curso_nome,
                    tu.nome AS turno_nome
            `,
            from: `
                FROM turmas t
                LEFT JOIN cursos c ON c.id = t.curso_id
                LEFT JOIN turnos tu ON tu.id = t.turno_id
            `,
            searchColumns: ['t.nome', 't.semestre_ref', 't.unidade', 'c.nome', 'tu.nome'],
            orderBy: `
                ORDER BY 
                    CAST(COALESCE(NULLIF(SUBSTRING(t.semestre_ref FROM '^[0-9]+'), ''), '999') AS INTEGER) ASC,
                    t.nome ASC,
                    t.id DESC
            `,
        };
    }

    if (entidade === 'usuarios') {
        return {
            select: `
                SELECT 
                    u.id, u.nome, u.email, u.tipo, u.token_acesso, u.curso_responsavel_id, u.unidade_responsavel,
                    c.nome AS curso_nome
            `,
            from: `
                FROM usuarios u
                LEFT JOIN cursos c ON c.id = u.curso_responsavel_id
            `,
            searchColumns: ['u.nome', 'u.email', 'u.tipo', 'u.token_acesso', 'c.nome', 'u.unidade_responsavel'],
            orderBy: `ORDER BY u.id DESC`,
        };
    }

    const alias = entidade[0];
    return {
        select: `SELECT ${alias}.*`,
        from: `FROM ${entidade} ${alias}`,
        searchColumns: [`${alias}.nome`],
        orderBy: `ORDER BY ${alias}.id DESC`,
    };
};

const montarQueryBasePaginacao = (req, token, campos) => {
    const params = new URLSearchParams();
    params.set('token', token);

    campos.forEach((campo) => {
        const valor = req.query[campo];
        if (typeof valor === 'string' && valor.trim()) {
            params.set(campo, valor.trim());
        }
    });

    return params.toString();
};

const obterReturnToSeguro = (req) => {
    const raw = typeof req.query.return_to === 'string' ? req.query.return_to.trim() : '';
    if (!raw) return '';

    // Evita redirect externo e mantém navegação apenas no painel
    const base = req.basePathPrefix || '';
    const adminLocal = '/admin/';
    const adminComBase = `${base}${adminLocal}`;

    if (!(raw.startsWith(adminLocal) || raw.startsWith(adminComBase))) {
        return '';
    }

    return raw;
};

const anexarReturnTo = (url, returnTo) => {
    if (!returnTo) return url;
    const joiner = url.includes('?') ? '&' : '?';
    return `${url}${joiner}return_to=${encodeURIComponent(returnTo)}`;
};

exports.dashboard = async (req, res) => {
    const usuario = res.locals.usuarioLogado;

    try {
        let whereTurmas = '';
        const paramsTurmas = [];

        if (usuario.tipo === 'coordenador') {
            whereTurmas = ' WHERE curso_id = $1';
            paramsTurmas.push(usuario.curso_responsavel_id);
        } else if (usuario.tipo === 'nap') {
            whereTurmas = ' WHERE unidade = $1';
            paramsTurmas.push(usuario.unidade_responsavel);
        }

        const [
            turmasRes,
            cursosRes,
            profsRes,
            disciplinasRes,
            turnosRes,
            usuariosRes,
            pendenciasSalaRes,
        ] = await Promise.all([
            db.query(`SELECT COUNT(*)::int AS total FROM turmas${whereTurmas}`, paramsTurmas),
            usuario.tipo === 'admin'
                ? db.query('SELECT COUNT(*)::int AS total FROM cursos')
                : usuario.tipo === 'coordenador'
                    ? db.query('SELECT COUNT(*)::int AS total FROM cursos WHERE id = $1', [usuario.curso_responsavel_id])
                    : Promise.resolve({ rows: [{ total: 0 }] }),
            usuario.tipo === 'nap'
                ? Promise.resolve({ rows: [{ total: 0 }] })
                : db.query('SELECT COUNT(*)::int AS total FROM professores'),
            usuario.tipo === 'nap'
                ? Promise.resolve({ rows: [{ total: 0 }] })
                : db.query('SELECT COUNT(*)::int AS total FROM disciplinas'),
            usuario.tipo === 'admin'
                ? db.query('SELECT COUNT(*)::int AS total FROM turnos')
                : Promise.resolve({ rows: [{ total: 0 }] }),
            usuario.tipo === 'admin'
                ? db.query('SELECT COUNT(*)::int AS total FROM usuarios')
                : Promise.resolve({ rows: [{ total: 0 }] }),
            db.query(
                `
                SELECT COUNT(*)::int AS total
                FROM grade g
                JOIN turmas t ON t.id = g.turma_id
                ${whereTurmas ? `${whereTurmas.replace('curso_id', 't.curso_id').replace('unidade', 't.unidade')} AND` : ' WHERE'}
                COALESCE(TRIM(g.sala), '') = ''
                `,
                paramsTurmas
            ),
        ]);

        res.render('admin/dashboard', {
            stats: {
                turmas: turmasRes.rows[0].total,
                cursos: cursosRes.rows[0].total,
                professores: profsRes.rows[0].total,
                disciplinas: disciplinasRes.rows[0].total,
                turnos: turnosRes.rows[0].total,
                usuarios: usuariosRes.rows[0].total,
                pendenciasSala: pendenciasSalaRes.rows[0].total,
            },
        });
    } catch (err) {
        res.status(500).send('Erro ao carregar dashboard: ' + err.message);
    }
};

// --- LISTAR COM FILTROS + BUSCA + PAGINAÇÃO ---
exports.listar = async (req, res) => {
    const tabela = req.params.entidade;
    const usuario = res.locals.usuarioLogado;
    const token = req.query.token;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filtroCurso = typeof req.query.filtro_curso === 'string' ? req.query.filtro_curso.trim() : '';
    const filtroUnidade = typeof req.query.filtro_unidade === 'string' ? req.query.filtro_unidade.trim() : '';
    const filtroTurno = typeof req.query.filtro_turno === 'string' ? req.query.filtro_turno.trim() : '';
    const paginaAtual = Math.max(parseIntSeguro(req.query.page, 1), 1);
    const porPaginaInformado = parseIntSeguro(req.query.per_page, 10);
    const porPagina = [10, 20, 50].includes(porPaginaInformado) ? porPaginaInformado : 10;

    const acesso = garantirAcessoEntidade(res, tabela);
    if (!acesso.ok) {
        return res.status(acesso.status).send(acesso.msg);
    }

    try {
        const config = buildListConfig(tabela);
        const where = [];
        let params = [];
        let paramIndex = 1;

        if (tabela === 'turmas') {
            if (usuario.tipo === 'coordenador') {
                where.push(`t.curso_id = $${paramIndex++}`);
                params.push(usuario.curso_responsavel_id);
            }
            if (usuario.tipo === 'nap') {
                where.push(`t.unidade = $${paramIndex++}`);
                params.push(usuario.unidade_responsavel);
            }
            if (filtroCurso) {
                where.push(`t.curso_id = $${paramIndex++}`);
                params.push(filtroCurso);
            }
            if (filtroUnidade) {
                where.push(`t.unidade = $${paramIndex++}`);
                params.push(filtroUnidade);
            }
            if (filtroTurno) {
                where.push(`t.turno_id = $${paramIndex++}`);
                params.push(filtroTurno);
            }
        } else if (tabela === 'cursos' && usuario.tipo === 'coordenador') {
            where.push(`c.id = $${paramIndex++}`);
            params.push(usuario.curso_responsavel_id);
        }

        if (q && config.searchColumns.length > 0) {
            const searchParts = config.searchColumns.map((col) => {
                params.push(`%${q}%`);
                return `${col} ILIKE $${paramIndex++}`;
            });
            where.push(`(${searchParts.join(' OR ')})`);
        }

        const whereClause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

        const totalRes = await db.query(
            `SELECT COUNT(*)::int AS total ${config.from} ${whereClause}`,
            params
        );

        const totalRegistros = totalRes.rows[0].total;
        const totalPaginas = Math.max(Math.ceil(totalRegistros / porPagina), 1);
        const paginaSegura = Math.min(paginaAtual, totalPaginas);
        const offset = (paginaSegura - 1) * porPagina;

        const paramsListagem = [...params, porPagina, offset];
        const sqlListagem = `
            ${config.select}
            ${config.from}
            ${whereClause}
            ${config.orderBy}
            LIMIT $${paramsListagem.length - 1}
            OFFSET $${paramsListagem.length}
        `;

        const result = await db.query(sqlListagem, paramsListagem);

        let listaCursosParaFiltro = [];
        let listaUnidadesParaFiltro = [];
        let listaTurnosParaFiltro = [];

        if (tabela === 'turmas') {
            if (usuario.tipo === 'admin') {
                listaCursosParaFiltro = (await db.query('SELECT id, nome FROM cursos ORDER BY nome')).rows;
            } else if (usuario.tipo === 'coordenador') {
                listaCursosParaFiltro = (await db.query(
                    'SELECT id, nome FROM cursos WHERE id = $1 ORDER BY nome',
                    [usuario.curso_responsavel_id]
                )).rows;
            }

            if (usuario.tipo === 'nap') {
                listaUnidadesParaFiltro = [{
                    unidade: usuario.unidade_responsavel,
                }];
            } else if (usuario.tipo === 'coordenador') {
                listaUnidadesParaFiltro = (await db.query(
                    'SELECT DISTINCT unidade FROM turmas WHERE curso_id = $1 ORDER BY unidade',
                    [usuario.curso_responsavel_id]
                )).rows;
            } else {
                listaUnidadesParaFiltro = (await db.query(
                    'SELECT DISTINCT unidade FROM turmas ORDER BY unidade'
                )).rows;
            }

            listaTurnosParaFiltro = (await db.query('SELECT id, nome FROM turnos ORDER BY ordem, id')).rows;
        }

        const queryBase = montarQueryBasePaginacao(req, token, [
            'q',
            'filtro_curso',
            'filtro_unidade',
            'filtro_turno',
            'per_page',
        ]);

        res.render('admin/listar', {
            tabela,
            entidadeLabel: LABELS_ENTIDADE[tabela] || tabela,
            itens: result.rows,
            cursosFiltro: listaCursosParaFiltro,
            unidadesFiltro: listaUnidadesParaFiltro,
            turnosFiltro: listaTurnosParaFiltro,
            filtros: {
                q,
                filtro_curso: filtroCurso,
                filtro_unidade: filtroUnidade,
                filtro_turno: filtroTurno,
                per_page: porPagina,
            },
            paginacao: {
                paginaAtual: paginaSegura,
                totalPaginas,
                totalRegistros,
                porPagina,
                inicio: totalRegistros === 0 ? 0 : offset + 1,
                fim: Math.min(offset + porPagina, totalRegistros),
            },
            queryBase,
            returnToAtual: req.originalUrl,
        });

    } catch (err) {
        res.status(500).send("Erro ao listar: " + err.message);
    }
};

// --- FORMULÁRIOS ---
exports.formCriar = async (req, res) => {
    const tabela = req.params.entidade;
    const usuario = res.locals.usuarioLogado;

    const acesso = garantirAcessoEntidade(res, tabela);
    if (!acesso.ok) {
        return res.status(acesso.status).send(acesso.msg);
    }

    if (usuario.tipo === 'nap') return res.status(403).send("NAP não cria registros.");

    try {
        let opcoesCursos = [], opcoesTurnos = [];
        const returnTo = obterReturnToSeguro(req);

        if (tabela === 'turmas') {
            if (usuario.tipo === 'admin') {
                opcoesCursos = (await db.query('SELECT * FROM cursos ORDER BY nome')).rows;
            } else {
                opcoesCursos = (await db.query('SELECT * FROM cursos WHERE id = $1', [usuario.curso_responsavel_id])).rows;
            }
            opcoesTurnos = (await db.query('SELECT * FROM turnos ORDER BY ordem')).rows;
        } 
        else if (tabela === 'usuarios') {
             opcoesCursos = (await db.query('SELECT * FROM cursos ORDER BY nome')).rows;
        }

        res.render('admin/form', { tabela, cursos: opcoesCursos, turnos: opcoesTurnos, item: undefined, returnTo });
    } catch (err) {
        res.status(500).send("Erro: " + err.message);
    }
};

exports.formEditar = async (req, res) => {
    const { entidade, id } = req.params;
    const usuario = res.locals.usuarioLogado;

    const acesso = garantirAcessoEntidade(res, entidade);
    if (!acesso.ok) {
        return res.status(acesso.status).send(acesso.msg);
    }

    if (usuario.tipo === 'nap') return res.status(403).send("NAP não edita registros.");

    try {
        const itemRes = await db.query(`SELECT * FROM ${entidade} WHERE id = $1`, [id]);
        const item = itemRes.rows[0];
        const returnTo = obterReturnToSeguro(req);

        // Segurança Coordenador
        if (usuario.tipo === 'coordenador') {
            if (entidade === 'turmas' && item.curso_id !== usuario.curso_responsavel_id) {
                return res.status(403).send("Turma de outro curso.");
            }
            if (entidade === 'cursos' && item.id !== usuario.curso_responsavel_id) {
                return res.status(403).send("Acesso negado.");
            }
        }

        let opcoesCursos = [], opcoesTurnos = [];
        if (entidade === 'turmas') {
            if (usuario.tipo === 'admin') {
                opcoesCursos = (await db.query('SELECT * FROM cursos ORDER BY nome')).rows;
            } else {
                opcoesCursos = (await db.query('SELECT * FROM cursos WHERE id = $1', [usuario.curso_responsavel_id])).rows;
            }
            opcoesTurnos = (await db.query('SELECT * FROM turnos ORDER BY ordem')).rows;
        } else if (entidade === 'usuarios') {
             opcoesCursos = (await db.query('SELECT * FROM cursos ORDER BY nome')).rows;
        }

        res.render('admin/form', { tabela: entidade, cursos: opcoesCursos, turnos: opcoesTurnos, item: item, returnTo });
    } catch (err) {
        res.status(500).send("Erro: " + err.message);
    }
};

// --- SALVAR (Com Unidade e Roles) ---
exports.salvar = async (req, res) => {
    const tabela = req.params.entidade;
    const dados = req.body;
    const token = req.query.token;
    const returnTo = obterReturnToSeguro(req);
    const usuario = res.locals.usuarioLogado;

    const acesso = garantirAcessoEntidade(res, tabela);
    if (!acesso.ok) {
        return res.status(acesso.status).send(acesso.msg);
    }

    if (usuario.tipo === 'nap') return res.status(403).send("Acesso Negado.");

    try {
        if (tabela === 'turmas') {
            const cursoFinal = usuario.tipo === 'coordenador' ? usuario.curso_responsavel_id : dados.curso_id;
            await db.query(
                `INSERT INTO turmas (nome, semestre_ref, curso_id, turno_id, unidade) VALUES ($1, $2, $3, $4, $5)`,
                [dados.nome, dados.semestre_ref, cursoFinal, dados.turno_id, dados.unidade]
            );
        } else if (tabela === 'usuarios') {
            const cursoId = dados.curso_responsavel_id || null;
            const unidadeResp = dados.unidade_responsavel || null;
            await db.query(
                `INSERT INTO usuarios (nome, email, senha, tipo, token_acesso, curso_responsavel_id, unidade_responsavel) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [dados.nome, dados.email, dados.senha, dados.tipo, dados.token_acesso, cursoId, unidadeResp]
            );
        } else if (tabela === 'cursos') {
            await db.query(
                `INSERT INTO cursos (nome, coordenador, semestres_total) VALUES ($1, $2, $3)`,
                [dados.nome, dados.coordenador, dados.semestres_total]
            );
        } else if (tabela === 'turnos') {
             await db.query(`INSERT INTO turnos (nome, slug) VALUES ($1, LOWER($1))`, [dados.nome]);
        } else {
            await db.query(`INSERT INTO ${tabela} (nome) VALUES ($1)`, [dados.nome]);
        }
        res.redirect(returnTo || withBase(req, `/admin/${tabela}?token=${token}`));
    } catch (err) {
        res.status(500).send("Erro ao salvar: " + err.message);
    }
};

exports.atualizar = async (req, res) => {
    const { entidade, id } = req.params;
    const dados = req.body;
    const token = req.query.token;
    const returnTo = obterReturnToSeguro(req);
    const usuario = res.locals.usuarioLogado;

    const acesso = garantirAcessoEntidade(res, entidade);
    if (!acesso.ok) {
        return res.status(acesso.status).send(acesso.msg);
    }

    if (usuario.tipo === 'nap') return res.status(403).send("Acesso Negado.");

    try {
        if (entidade === 'turmas') {
             const cursoFinal = usuario.tipo === 'coordenador' ? usuario.curso_responsavel_id : dados.curso_id;
            await db.query(
                `UPDATE turmas SET nome=$1, semestre_ref=$2, curso_id=$3, turno_id=$4, unidade=$5 WHERE id=$6`,
                [dados.nome, dados.semestre_ref, cursoFinal, dados.turno_id, dados.unidade, id]
            );
        } else if (entidade === 'usuarios') {
            const cursoId = dados.curso_responsavel_id || null;
            const unidadeResp = dados.unidade_responsavel || null;
            const senhaAtual = await db.query('SELECT senha FROM usuarios WHERE id = $1', [id]);
            const senhaFinal = (typeof dados.senha === 'string' && dados.senha.trim())
                ? dados.senha.trim()
                : (senhaAtual.rows[0] ? senhaAtual.rows[0].senha : null);

            await db.query(
                `UPDATE usuarios SET nome=$1, email=$2, senha=$3, tipo=$4, token_acesso=$5, curso_responsavel_id=$6, unidade_responsavel=$7 WHERE id=$8`,
                [dados.nome, dados.email, senhaFinal, dados.tipo, dados.token_acesso, cursoId, unidadeResp, id]
            );
        } else if (entidade === 'cursos') {
            await db.query(
                `UPDATE cursos SET nome=$1, coordenador=$2, semestres_total=$3 WHERE id=$4`,
                [dados.nome, dados.coordenador, dados.semestres_total, id]
            );
        } else {
            await db.query(`UPDATE ${entidade} SET nome=$1 WHERE id=$2`, [dados.nome, id]);
        }
        res.redirect(returnTo || withBase(req, `/admin/${entidade}?token=${token}`));
    } catch (err) {
        res.status(500).send("Erro ao atualizar: " + err.message);
    }
};

exports.excluir = async (req, res) => {
    const tabela = req.params.entidade;
    const { id } = req.params;
    const token = req.query.token;
    const returnTo = obterReturnToSeguro(req);
    const usuario = res.locals.usuarioLogado;

    const acesso = garantirAcessoEntidade(res, tabela);
    if (!acesso.ok) {
        return res.status(acesso.status).send(acesso.msg);
    }
    
    if (usuario.tipo === 'nap') return res.status(403).send("Proibido.");
    
    try {
        await db.query(`DELETE FROM ${tabela} WHERE id = $1`, [id]);
        res.redirect(returnTo || withBase(req, `/admin/${tabela}?token=${token}`));
    } catch (err) {
        if (err.code === '23503') res.status(400).send("Erro: Dependências encontradas.");
        else res.status(500).send("Erro: " + err.message);
    }
};

// --- GRADE ---
exports.montarGrade = async (req, res) => {
    const { id } = req.params;
    const usuario = res.locals.usuarioLogado;
    const token = req.query.token;
    try {
        const turma = (await db.query('SELECT * FROM turmas WHERE id = $1', [id])).rows[0];

        // Segurança NAP (Verifica unidade)
        if (usuario.tipo === 'nap' && turma.unidade !== usuario.unidade_responsavel) {
            return res.status(403).send(`Acesso Negado: Esta turma é de ${turma.unidade}, você é de ${usuario.unidade_responsavel}.`);
        }
        // Segurança Coordenador
        if (usuario.tipo === 'coordenador' && turma.curso_id !== usuario.curso_responsavel_id) {
            return res.status(403).send("Acesso Negado.");
        }
        
        const grade = await db.query(`
            SELECT 
                g.id,
                g.dia_semana,
                g.sala,
                g.disciplina_id,
                g.professor_id,
                d.nome as disciplina,
                p.nome as professor
            FROM grade g
            LEFT JOIN disciplinas d ON g.disciplina_id = d.id
            LEFT JOIN professores p ON g.professor_id = p.id
            WHERE g.turma_id = $1
            ORDER BY 
                CASE g.dia_semana
                    WHEN 'SEG' THEN 1
                    WHEN 'TER' THEN 2
                    WHEN 'QUA' THEN 3
                    WHEN 'QUI' THEN 4
                    WHEN 'SEX' THEN 5
                    ELSE 99
                END,
                g.id
        `, [id]);
        const profs = await db.query('SELECT * FROM professores ORDER BY nome');
        const disc = await db.query('SELECT * FROM disciplinas ORDER BY nome');
        const returnTo = obterReturnToSeguro(req) || withBase(req, `/admin/turmas?token=${token}`);
        res.render('admin/montar_grade', { turma, grade: grade.rows, professores: profs.rows, disciplinas: disc.rows, returnTo });
    } catch (err) { res.status(500).send(err.message); }
};

exports.atualizarGradeEmLote = async (req, res) => {
    const { id } = req.params;
    const token = req.query.token;
    const returnTo = obterReturnToSeguro(req);
    const usuario = res.locals.usuarioLogado;
    const itens = (req.body && typeof req.body.itens === 'object') ? req.body.itens : {};
    const diasValidos = new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);

    const client = await db.getClient();

    try {
        const turmaRes = await client.query('SELECT * FROM turmas WHERE id = $1', [id]);
        const turma = turmaRes.rows[0];

        if (!turma) {
            return res.status(404).send('Turma não encontrada.');
        }

        if (usuario.tipo === 'nap' && turma.unidade !== usuario.unidade_responsavel) {
            return res.status(403).send(`Acesso Negado: Esta turma é de ${turma.unidade}, você é de ${usuario.unidade_responsavel}.`);
        }

        if (usuario.tipo === 'coordenador' && turma.curso_id !== usuario.curso_responsavel_id) {
            return res.status(403).send('Acesso Negado.');
        }

        await client.query('BEGIN');

        for (const [idItem, dadosItem] of Object.entries(itens)) {
            const itemId = parseIntSeguro(idItem, NaN);
            if (!Number.isInteger(itemId)) continue;

            const sala = typeof dadosItem.sala === 'string' ? dadosItem.sala.trim() : null;
            const salaFinal = sala ? sala : null;

            if (usuario.tipo === 'nap') {
                await client.query(
                    'UPDATE grade SET sala = $1 WHERE id = $2 AND turma_id = $3',
                    [salaFinal, itemId, id]
                );
                continue;
            }

            if (dadosItem.remover === 'on') {
                await client.query('DELETE FROM grade WHERE id = $1 AND turma_id = $2', [itemId, id]);
                continue;
            }

            const diaSemana = typeof dadosItem.dia_semana === 'string' ? dadosItem.dia_semana : '';
            const disciplinaId = parseIntSeguro(dadosItem.disciplina_id, NaN);
            const professorId = parseIntSeguro(dadosItem.professor_id, NaN);

            if (!diasValidos.has(diaSemana)) {
                throw new Error(`Dia inválido para item ${itemId}.`);
            }

            if (!Number.isInteger(disciplinaId) || !Number.isInteger(professorId)) {
                throw new Error(`Disciplina/Professor inválido para item ${itemId}.`);
            }

            await client.query(
                `
                UPDATE grade
                SET dia_semana = $1, disciplina_id = $2, professor_id = $3, sala = $4
                WHERE id = $5 AND turma_id = $6
                `,
                [diaSemana, disciplinaId, professorId, salaFinal, itemId, id]
            );
        }

        await client.query('COMMIT');
        res.redirect(anexarReturnTo(withBase(req, `/admin/turmas/${id}/grade?token=${token}`), returnTo));
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).send('Erro ao atualizar grade: ' + err.message);
    } finally {
        client.release();
    }
};

exports.adicionarItemGrade = async (req, res) => {
    const { id } = req.params;
    const { dia_semana, disciplina_id, professor_id, sala } = req.body;
    const token = req.query.token;
    const returnTo = obterReturnToSeguro(req);
    const usuario = res.locals.usuarioLogado;

    // NAP não adiciona, só edita sala
    if (usuario.tipo === 'nap') return res.status(403).send("NAP não adiciona disciplinas.");

    try {
        // --- REMOVIDO: BLOQUEIO DE DUPLICIDADE ---
        // Agora o sistema permite adicionar quantas aulas quiser no mesmo dia.
        
        await db.query(`
            INSERT INTO grade (turma_id, dia_semana, disciplina_id, professor_id, sala)
            VALUES ($1, $2, $3, $4, $5)
        `, [id, dia_semana, disciplina_id, professor_id, sala]);

        res.redirect(anexarReturnTo(withBase(req, `/admin/turmas/${id}/grade?token=${token}`), returnTo));
    } catch (err) {
        res.status(500).send("Erro ao adicionar: " + err.message);
    }
};

exports.removerItemGrade = async (req, res) => {
    const { id, id_item } = req.params;
    const token = req.query.token;
    const returnTo = obterReturnToSeguro(req);
    const usuario = res.locals.usuarioLogado;
    if (usuario.tipo === 'nap') return res.status(403).send("NAP não remove.");

    await db.query('DELETE FROM grade WHERE id = $1', [id_item]);
    res.redirect(anexarReturnTo(withBase(req, `/admin/turmas/${id}/grade?token=${token}`), returnTo));
};

exports.atualizarSalaGrade = async (req, res) => {
    const { id, id_item } = req.params;
    const { sala } = req.body;
    const token = req.query.token;
    const returnTo = obterReturnToSeguro(req);
    await db.query('UPDATE grade SET sala = $1 WHERE id = $2', [sala, id_item]);
    res.redirect(anexarReturnTo(withBase(req, `/admin/turmas/${id}/grade?token=${token}`), returnTo));
};
