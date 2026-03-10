#!/usr/bin/env bash

set -e

echo "🚀 Adicionando submodules SEMIS..."

# Formato: "repositório|caminho|branch"
declare -a submodules=(
  "https://github.com/jahnical/malawi-dhis2-semis-admission.git|src/modules/admission|main"
  "https://github.com/Saudigitus/dhis2-semis-attendance.git|src/modules/attendance|develop"
  "https://github.com/Saudigitus/dhis2-semis-enrollment.git|src/modules/enrollment|develop"
  "https://github.com/Saudigitus/dhis2-semis-final-result.git|src/modules/final-result|develop"
  "https://github.com/Saudigitus/dhis2-semis-performance.git|src/modules/performance|develop"
  "https://github.com/Saudigitus/dhis2-emis-school-calendar.git|src/modules/school-calendar|i18n"
  "https://github.com/Saudigitus/dhis2-semis-transfer.git|src/modules/transfer|develop"
  "https://github.com/Saudigitus/dhis2-emis-config.git|src/modules/configurations|develop"
  "https://github.com/Saudigitus/dhis2-semis-transfer-execute.git|src/modules/transfer-execute|develop"
  "https://github.com/Saudigitus/dhis2-semis-components.git|src/libs/components|develop"
  "https://github.com/Saudigitus/dhis2-semis-types.git|src/libs/types|preview"
  "https://github.com/Saudigitus/dhis2-semis-customfunc.git|src/libs/functions|develop"
)

for entry in "${submodules[@]}"; do
  IFS="|" read -r repo path branch <<< "$entry"

  if [ -d "$path/.git" ]; then
    echo "✅ Submodule já existe em $path — ignorando"
  else
    echo "➕ Adicionando submodule: $repo -> $path (branch: ${branch:-default})"

    if [ -n "$branch" ]; then
      git submodule add -b "$branch" "$repo" "$path"
    else
      git submodule add "$repo" "$path"
    fi
  fi

  echo "🙈 Configurando Git para ignorar mudanças no submodule $path"

  # Ignorar mudanças localmente
  git config submodule."$path".ignore all

  # Persistir no .gitmodules (para toda a equipa)
  git config -f .gitmodules submodule."$path".ignore all
done

echo "📦 Inicializando e atualizando submodules..."
git submodule update --init --recursive

echo "📌 Submodules configurados para ignorar todas as alterações internas"
echo "💾 Não se esqueça de commitar o .gitmodules!"

echo "🎉 Todos os submodules foram adicionados com sucesso!"
