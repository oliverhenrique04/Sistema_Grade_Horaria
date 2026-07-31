#!/usr/bin/env node
/**
 * Interface de linha de comando para tarefas de banco de dados.
 *
 *   node src/database/cli.js migrate      Aplica migrations pendentes
 *   node src/database/cli.js status       Lista migrations aplicadas/pendentes
 *   node src/database/cli.js seed         Carga inicial (turnos, horarios, periodo, admin)
 *   node src/database/cli.js relatorio    Relatorio da migracao de dados legados
 *   node src/database/cli.js senha <email> [senha]   Define a senha de um usuario
 */
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const config = require('../config/env');
const db = require('../config/db');
const { migrar, status } = require('./migrate');
const seeds = require('./seeds');

const comandos = {
    async migrate() {
        console.log(`Aplicando migrations (${config.ambiente} / schema ${config.banco.schema})...`);
        const aplicadas = await migrar();
        aplicadas.forEach((item) => {
            if (item.detalhe) {
                console.log(`     ${JSON.stringify(item.detalhe)}`);
            }
        });
        console.log('Migrations concluidas.');
    },

    async status() {
        const lista = await status();
        lista.forEach((item) => {
            console.log(`${item.aplicada ? '[x]' : '[ ]'} ${item.arquivo}`);
        });
        const pendentes = lista.filter((item) => !item.aplicada).length;
        console.log(`\n${lista.length} migrations, ${pendentes} pendente(s).`);
    },

    async seed() {
        const resultado = await seeds.executar();
        console.log(`Campus criados: ${resultado.campus}`);
        console.log(`Turnos garantidos: ${resultado.turnos}`);
        console.log(`Horarios criados: ${resultado.horarios}`);
        console.log(`Periodo letivo atual: ${resultado.periodo}`);
        if (resultado.admin.criado) {
            console.log(`Administrador criado: ${resultado.admin.email}`);
            if (resultado.admin.senha) {
                console.log(
                    `Senha gerada (anote agora, nao sera exibida novamente): ${resultado.admin.senha}`
                );
            } else {
                console.log('Senha definida a partir de ADMIN_SENHA.');
            }
        } else {
            console.log(`Administrador ja existente: ${resultado.admin.email} (perfil garantido)`);
        }
    },

    async relatorio() {
        const existe = await db.query(`SELECT to_regclass('relatorio_migracao_legado') AS tabela`);
        if (!existe.rows[0].tabela) {
            console.log(
                'Nenhum relatorio disponivel: a migracao de dados legados ainda nao foi executada.'
            );
            return;
        }

        const linhas = await db.query(
            'SELECT categoria, detalhe, quantidade FROM relatorio_migracao_legado ORDER BY categoria, detalhe'
        );

        if (linhas.rowCount === 0) {
            console.log('Relatorio vazio.');
            return;
        }

        console.log('\nRelatorio da migracao de dados legados\n');
        linhas.rows.forEach((linha) => {
            console.log(
                `  ${linha.categoria.padEnd(28)} ${String(linha.quantidade).padStart(6)}  ${linha.detalhe || ''}`
            );
        });
        console.log('');
    },

    async senha(email, senhaInformada) {
        if (!email) {
            throw new Error(
                'Informe o e-mail: npm run usuario:senha -- usuario@dominio.com [senha]'
            );
        }

        const senha = senhaInformada || crypto.randomBytes(12).toString('base64url');
        if (senha.length < 8) {
            throw new Error('A senha deve ter ao menos 8 caracteres.');
        }

        const hash = await bcrypt.hash(senha, 12);
        const resultado = await db.query(
            'UPDATE usuarios SET senha_hash = $1 WHERE LOWER(email) = LOWER($2) RETURNING id, nome, email',
            [hash, email]
        );

        if (resultado.rowCount === 0) {
            throw new Error(`Usuario nao encontrado: ${email}`);
        }

        console.log(
            `Senha atualizada para ${resultado.rows[0].nome} <${resultado.rows[0].email}>.`
        );
        if (!senhaInformada) {
            console.log(`Senha gerada (anote agora): ${senha}`);
        }
    },
};

const principal = async () => {
    const [comando, ...argumentos] = process.argv.slice(2);
    const executor = comandos[comando];

    if (!executor) {
        console.error(`Comando invalido: ${comando || '(vazio)'}`);
        console.error(`Disponiveis: ${Object.keys(comandos).join(', ')}`);
        process.exitCode = 1;
        return;
    }

    await executor(...argumentos);
};

principal()
    .catch((erro) => {
        console.error(`Erro: ${erro.message}`);
        process.exitCode = 1;
    })
    .finally(() => db.encerrar());
