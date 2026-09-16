#!/bin/zsh

set -e
cd -- "${0:A:h}"

echo "Nostraxis"
echo "Abriendo http://localhost:4173"
echo "Mantén esta ventana abierta. Pulsa Ctrl+C para detener el servidor."
echo

exec npm run dev
