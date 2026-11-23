# FictiBank V7.2 Online

Banco **100% fictício**, criado para simulação/estudo. Não possui conexão com Pix real, bancos ou dinheiro real.

## Recursos
- Login por usuário + senha
- Cadastro de múltiplos usuários
- Chave Pix fictícia automática
- Pix fictício entre usuários
- QR Code Pix fictício
- Notificação de Pix recebido
- Animação de envio
- Comprovante com ID e data
- Cartão virtual de demonstração
- Gráfico de entradas/saídas
- Saldo e extrato persistentes em SQLite

## Contas iniciais
- Bruno — usuário `bruno` — senha `Bruno*1902`
- Irmão — usuário `irmao` — senha `4321`

Altere as credenciais se este projeto for usado por outras pessoas.

## Rodar localmente
```bash
npm install
npm start
```

Abra `http://localhost:3000`.

## Deploy
O serviço precisa ser um Web Service Node.js.
- Build Command: `npm install`
- Start Command: `npm start`

A aplicação usa SQLite. Em hospedagens com filesystem efêmero, configure armazenamento persistente ou troque o banco por um serviço gerenciado antes de depender dele para dados importantes.

## Observação de segurança
Este projeto é uma simulação. Não use senhas reais e não reutilize credenciais importantes.