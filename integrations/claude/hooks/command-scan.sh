# shellcheck shell=bash
# shellcheck disable=SC2034  # Globals set here are read by the hooks that source this file.
#
# Best-effort lexer and path classifier shared by the Claude Code PreToolUse
# Bash hooks. It splits a command into simple-command segments and words with
# quotes removed. It is not a shell parser: words it cannot resolve statically
# (parameter expansion, command substitution, escapes, brace expansion) are
# flagged so recognized commands cannot use quiet-path exemptions. Dynamic
# executable names, scripts and unrecognized commands are not covered. This
# detector is not an enforcement boundary or a complete shell interpreter.
#
# Source it; it defines functions and CS_* globals only and runs nothing.

CS_WORDS=()       # word text, quotes removed
CS_FLAGS=()       # per word: "d" = dynamic (cannot be resolved), "g" = unquoted glob
CS_SEG=()         # per word: segment number
CS_START=()       # per segment: index of its first word
CS_END=()         # per segment: index after its last word
CS_PENDING=()     # command texts found inside substitutions, scanned afterwards
CS_I=0            # index of the program word found by cs_invocation
CS_VIA=direct     # direct, wrapper (sudo, env, xargs, ...), or exec (docker exec, ssh, ...)
CS_WRAPPER=""     # program name of the wrapper, if any
CS_PRIV=false     # true when a privilege wrapper (sudo, doas, ...) precedes the program
CS_TEXT=""        # words of the current invocation joined by single spaces
CS_CWD=""
CS_CWD_OK=false   # false when the working directory is unknown or a cd was seen
CS_SID=""
CS_ROOTS=()       # physical disposable roots
CS__ROOTS_DONE=false
CS_TOP=""
CS__TOP_DONE=false

CS_WRAPPERS='sudo|doas|run0|pkexec|env|command|builtin|exec|nohup|time|nice|ionice|timeout|stdbuf|xargs|parallel|watch|flock|unbuffer|chronic|setsid|caffeinate|systemd-run|strace|ltrace|npx|bunx|aws-vault|op|doppler|infisical|dotenv|envchain|chamber|direnv|mise|asdf|devbox'
CS_EXEC_HOSTS='docker|podman|nerdctl|kubectl|oc|uv|poetry|pipenv|pdm|hatch|rye'
CS_PRIVILEGED='sudo|doas|run0|pkexec'
CS_ARTIFACT_NAMES='node_modules|dist|build|__pycache__|.pytest_cache|.ruff_cache|.mypy_cache|.tox|.nox|.coverage|htmlcov|coverage|.next|.nuxt|.turbo|.parcel-cache|.svelte-kit|target|.eggs|.hypothesis'

cs__rest=""; cs__w=""; cs__f=""; cs__in=false; cs__skip=false
cs__heredoc=false; cs__hdmode=""; cs__quoted=false; cs__heredocs=()

cs__flush() {
  if [[ "$cs__in" == true ]]; then
    if [[ "$cs__heredoc" == true ]]; then
      [[ "$cs__f" == *d* ]] && cs__quoted=true
      cs__heredocs+=("$cs__hdmode|$cs__quoted|$cs__w")
      cs__heredoc=false
    elif [[ "$cs__skip" == false ]]; then
      CS_WORDS+=("$cs__w"); CS_FLAGS+=("$cs__f"); CS_SEG+=("$CS_NSEG")
    fi
    cs__skip=false
  fi
  cs__w=""; cs__f=""; cs__in=false; cs__quoted=false
}

cs__segment_end() {
  cs__flush
  cs__skip=false; cs__heredoc=false
  CS_NSEG=$((CS_NSEG + 1))
}

# Consume the body of every here-document opened on the line just ended.
cs__heredoc_bodies() {
  local entry mode quoted delim line body
  (( ${#cs__heredocs[@]} > 0 )) || return 0
  for entry in "${cs__heredocs[@]}"; do
    mode=${entry%%|*}; entry=${entry#*|}
    quoted=${entry%%|*}; delim=${entry#*|}
    body=""
    while [[ -n "$cs__rest" ]]; do
      if [[ "$cs__rest" == *$'\n'* ]]; then
        line=${cs__rest%%$'\n'*}; cs__rest=${cs__rest#*$'\n'}
      else
        line=$cs__rest; cs__rest=""
      fi
      [[ "$mode" == - ]] && line=${line#"${line%%[!$'\t']*}"}
      [[ "$line" == "$delim" ]] && break
      body+=$line$'\n'
    done
    # An unquoted delimiter still expands substitutions inside the body.
    # shellcheck disable=SC2016  # Literal $( and backtick are being matched.
    if [[ "$quoted" != true && ( "$body" == *'$('* || "$body" == *'`'* ) ]]; then
      CS_PENDING+=("$body")
    fi
  done
  cs__heredocs=()
}

# After "$(" or "<(": collect the text up to the matching ")" for a later scan.
cs__substitution() {
  local depth=1 inner="" c run='^[^()'\''"\\]+' dq='^([^"\\]|\\.)*"'
  while [[ -n "$cs__rest" ]]; do
    if [[ "$cs__rest" =~ $run ]]; then
      inner+=${BASH_REMATCH[0]}; cs__rest=${cs__rest:${#BASH_REMATCH[0]}}
      continue
    fi
    c=${cs__rest:0:1}; cs__rest=${cs__rest:1}
    case "$c" in
      '(') depth=$((depth + 1)); inner+=$c ;;
      ')')
        depth=$((depth - 1))
        if (( depth == 0 )); then CS_PENDING+=("$inner"); return 0; fi
        inner+=$c
        ;;
      "'")
        if [[ "$cs__rest" == *"'"* ]]; then
          inner+="'${cs__rest%%"'"*}'"; cs__rest=${cs__rest#*"'"}
        else
          inner+="'$cs__rest"; cs__rest=""
        fi
        ;;
      '"')
        if [[ "$cs__rest" =~ $dq ]]; then
          inner+="\"${BASH_REMATCH[0]}"; cs__rest=${cs__rest:${#BASH_REMATCH[0]}}
        else
          inner+="\"$cs__rest"; cs__rest=""
        fi
        ;;
      \\) inner+="\\${cs__rest:0:1}"; cs__rest=${cs__rest:1} ;;
    esac
  done
  CS_PENDING+=("$inner")
}

cs__backtick() {
  # shellcheck disable=SC2016  # A literal backtick pattern.
  local re='^([^`\\]|\\.)*`' match
  [[ "$cs__rest" =~ $re ]] || return 1
  match=${BASH_REMATCH[0]}
  CS_PENDING+=("${match%?}")
  cs__rest=${cs__rest:${#match}}
}

cs__double_quote() {
  local c run='^[^"\\$`]+'
  while [[ -n "$cs__rest" ]]; do
    if [[ "$cs__rest" =~ $run ]]; then
      cs__w+=${BASH_REMATCH[0]}; cs__rest=${cs__rest:${#BASH_REMATCH[0]}}
      continue
    fi
    c=${cs__rest:0:1}; cs__rest=${cs__rest:1}
    case "$c" in
      '"') return 0 ;;
      \\)
        # Inside double quotes a backslash escapes only $ ` " \ and newline.
        case "${cs__rest:0:1}" in
          '$'|'`'|'"'|\\) cs__w+=${cs__rest:0:1}; cs__rest=${cs__rest:1} ;;
          $'\n') cs__rest=${cs__rest:1} ;;
          *) cs__w+=\\ ;;
        esac
        ;;
      '$')
        cs__f+=d
        if [[ "${cs__rest:0:1}" == '(' ]]; then
          cs__rest=${cs__rest:1}; cs__substitution; cs__w+="\$(...)"
        else
          cs__w+='$'
        fi
        ;;
      '`') cs__f+=d; cs__backtick || return 1; cs__w+="\`...\`" ;;
    esac
  done
  return 1
}

# Consume the rest of a redirection operator; the next word is its target.
cs__redirect() {
  local first=$1
  if [[ "$first" == '<' ]]; then
    if [[ "${cs__rest:0:2}" == '<<' ]]; then cs__rest=${cs__rest:2}; cs__skip=true; return 0; fi
    if [[ "${cs__rest:0:2}" == '<-' ]]; then
      cs__rest=${cs__rest:2}; cs__heredoc=true; cs__hdmode=-; return 0
    fi
    if [[ "${cs__rest:0:1}" == '<' ]]; then
      cs__rest=${cs__rest:1}; cs__heredoc=true; cs__hdmode=""; return 0
    fi
    [[ "${cs__rest:0:1}" == [\&\>] ]] && cs__rest=${cs__rest:1}
  else
    [[ "${cs__rest:0:1}" == [\>\|\&] ]] && cs__rest=${cs__rest:1}
  fi
  cs__skip=true
}

cs__scan_one() {
  local c run='^[^][:space:];&|()<>'\''"\$`*?{}~#[]+'
  cs__rest=$1; cs__w=""; cs__f=""; cs__in=false; cs__skip=false
  cs__heredoc=false; cs__quoted=false; cs__heredocs=()
  while [[ -n "$cs__rest" ]]; do
    if [[ "$cs__rest" =~ $run ]]; then
      cs__w+=${BASH_REMATCH[0]}; cs__in=true; cs__rest=${cs__rest:${#BASH_REMATCH[0]}}
      continue
    fi
    c=${cs__rest:0:1}; cs__rest=${cs__rest:1}
    case "$c" in
      ' '|$'\t') cs__flush ;;
      $'\n') cs__segment_end; cs__heredoc_bodies ;;
      ';'|'('|')') cs__segment_end ;;
      '&')
        if [[ "${cs__rest:0:1}" == '>' ]]; then
          cs__flush; cs__rest=${cs__rest:1}; cs__redirect '>'
        else
          [[ "${cs__rest:0:1}" == '&' ]] && cs__rest=${cs__rest:1}
          cs__segment_end
        fi
        ;;
      '|')
        [[ "${cs__rest:0:1}" == [\|\&] ]] && cs__rest=${cs__rest:1}
        cs__segment_end
        ;;
      '<'|'>')
        if [[ "${cs__rest:0:1}" == '(' ]]; then
          cs__flush; cs__rest=${cs__rest:1}; cs__substitution
          cs__in=true; cs__f+=d; cs__w+="$c(...)"
        else
          # A numeric word directly before the operator is a file descriptor.
          if [[ "$cs__in" == true && -z "$cs__f" && "$cs__w" =~ ^[0-9]+$ ]]; then
            cs__w=""; cs__in=false
          fi
          cs__flush; cs__redirect "$c"
        fi
        ;;
      "'")
        [[ "$cs__rest" == *"'"* ]] || return 1
        cs__in=true; cs__quoted=true
        cs__w+=${cs__rest%%"'"*}; cs__rest=${cs__rest#*"'"}
        ;;
      '"') cs__in=true; cs__quoted=true; cs__double_quote || return 1 ;;
      \\)
        if [[ "${cs__rest:0:1}" == $'\n' ]]; then
          cs__rest=${cs__rest:1}
        else
          cs__in=true; cs__f+=d; cs__w+=${cs__rest:0:1}; cs__rest=${cs__rest:1}
        fi
        ;;
      '$')
        cs__in=true; cs__f+=d
        if [[ "${cs__rest:0:1}" == '(' ]]; then
          cs__rest=${cs__rest:1}; cs__substitution; cs__w+="\$(...)"
        else
          cs__w+='$'
        fi
        ;;
      '`') cs__in=true; cs__f+=d; cs__backtick || return 1; cs__w+="\`...\`" ;;
      '*'|'?'|'[') cs__in=true; cs__f+=g; cs__w+=$c ;;
      '{'|'}')
        # A standalone brace is a group keyword; inside a word it expands.
        if [[ "$cs__in" == true || ( -n "$cs__rest" && "${cs__rest:0:1}" != [[:space:]\;] ) ]]; then
          cs__f+=d
        fi
        cs__in=true; cs__w+=$c
        ;;
      '~') [[ "$cs__in" == true ]] || cs__f+=d; cs__in=true; cs__w+='~' ;;
      '#')
        if [[ "$cs__in" == true ]]; then
          cs__w+='#'
        elif [[ "$cs__rest" == *$'\n'* ]]; then
          cs__rest=$'\n'${cs__rest#*$'\n'}
        else
          cs__rest=""
        fi
        ;;
    esac
  done
  cs__segment_end
  # A here-document on the last line has no body to skip.
  cs__heredocs=()
}

# Split a command into segments and words. Returns 1 when quoting is
# unbalanced or substitutions nest too deeply; callers should then ask.
cs_scan() {
  local k=0 i s LC_ALL=C
  CS_WORDS=(); CS_FLAGS=(); CS_SEG=(); CS_START=(); CS_END=(); CS_NSEG=0
  CS_PENDING=("$1")
  while (( k < ${#CS_PENDING[@]} )); do
    (( k <= 64 )) || return 1
    cs__scan_one "${CS_PENDING[k]}" || return 1
    k=$((k + 1))
  done
  for ((i = 0; i < ${#CS_WORDS[@]}; i++)); do
    s=${CS_SEG[i]}
    [[ -n "${CS_START[s]+set}" ]] || CS_START[s]=$i
    CS_END[s]=$((i + 1))
  done
}

# Segment numbers that contain at least one word, in order.
cs_segments() {
  (( ${#CS_START[@]} > 0 )) || return 0
  printf '%s\n' "${!CS_START[@]}"
}

# cs_invocation SEGMENT NAMES_REGEX: find the program the segment runs, looking
# through assignments, keywords, wrappers (sudo, env, xargs, ...) and
# container or remote exec. Sets CS_I, CS_VIA, CS_WRAPPER, CS_PRIV.
cs_invocation() {
  local seg=$1 re="^($2)\$" i j end base
  [[ -n "${CS_START[seg]+set}" ]] || return 1
  i=${CS_START[seg]}; end=${CS_END[seg]}
  while (( i < end )); do
    if [[ "${CS_WORDS[i]}" =~ ^[A-Za-z_][A-Za-z0-9_]*= || "${CS_WORDS[i]}" =~ ^(\{|\}|!|if|then|else|elif|do|while|until)$ ]]; then
      i=$((i + 1)); continue
    fi
    break
  done
  (( i < end )) || return 1
  [[ "${CS_FLAGS[i]}" != *d* ]] || return 1
  base=${CS_WORDS[i]##*/}
  CS_WRAPPER=""; CS_PRIV=false
  if [[ "$base" =~ $re ]]; then CS_I=$i; CS_VIA=direct; return 0; fi
  j=$((i + 1))
  if [[ "$base" =~ ^($CS_WRAPPERS)$ ]]; then
    CS_VIA=wrapper
  elif [[ "$base" =~ ^($CS_EXEC_HOSTS)$ ]]; then
    CS_VIA="exec"
    while (( j < end )) && [[ ! "${CS_WORDS[j]}" =~ ^(exec|run)$ ]]; do j=$((j + 1)); done
    j=$((j + 1))
  elif [[ "$base" == ssh ]]; then
    CS_VIA="exec"
  else
    return 1
  fi
  CS_WRAPPER=$base
  [[ "$base" =~ ^($CS_PRIVILEGED)$ ]] && CS_PRIV=true
  for ((; j < end; j++)); do
    [[ "${CS_FLAGS[j]}" != *d* ]] || continue
    base=${CS_WORDS[j]##*/}
    [[ "$base" =~ ^($CS_PRIVILEGED)$ ]] && CS_PRIV=true
    if [[ "$base" =~ $re ]]; then CS_I=$j; return 0; fi
  done
  return 1
}

# Join the words of the current invocation, from the program on.
cs_text() {
  local seg=$1 j end
  end=${CS_END[seg]}
  CS_TEXT=${CS_WORDS[CS_I]##*/}
  for ((j = CS_I + 1; j < end; j++)); do CS_TEXT+=" ${CS_WORDS[j]}"; done
}

# cs_has_word SEGMENT REGEX: true when a word after the program matches.
cs_has_word() {
  local seg=$1 re="^($2)\$" j end
  end=${CS_END[seg]}
  for ((j = CS_I + 1; j < end; j++)); do
    [[ "${CS_WORDS[j]}" =~ $re ]] && return 0
  done
  return 1
}

cs_context() {
  CS_CWD=""; CS_CWD_OK=false; CS_SID=""
  if [[ "$1" == /* && -d "$1" ]]; then CS_CWD=$1; CS_CWD_OK=true; fi
  [[ "$2" =~ ^[A-Za-z0-9_-]+$ ]] && CS_SID=$2
  CS__ROOTS_DONE=false; CS__TOP_DONE=false
  return 0
}

# Lexically normalize an absolute or working-directory-relative path into
# CS_PATH. Rejects ".." components rather than resolving them.
cs__normalize() {
  local p=$1 out="" part
  local -a parts=()
  [[ -n "$p" ]] || return 1
  if [[ "$p" != /* ]]; then
    [[ "$CS_CWD_OK" == true ]] || return 1
    p="$CS_CWD/$p"
  fi
  IFS=/ read -ra parts <<< "$p"
  for part in ${parts[@]+"${parts[@]}"}; do
    case "$part" in
      ''|.) ;;
      ..) return 1 ;;
      *) out+="/$part" ;;
    esac
  done
  CS_PATH=${out:-/}
}

# Resolve the symlinks of an absolute directory path into CS_PHYS; missing
# trailing components are kept as written.
cs__physical_dir() {
  local p=$1 suffix="" resolved
  while [[ ! -d "$p" ]]; do
    suffix="/${p##*/}$suffix"; p=${p%/*}
    [[ -n "$p" ]] || p=/
  done
  resolved=$(cd -P -- "$p" 2>/dev/null && pwd -P) || return 1
  CS_PHYS=${resolved%/}$suffix
  [[ -n "$CS_PHYS" ]] || CS_PHYS=/
}

# Split a path into its physical location: CS_REAL (physical parent plus the
# final component as written). Globs are allowed in the final component only,
# and never in a way that can match dot entries such as ".*".
cs__real_path() {
  local word=$1 flags=$2 last parent
  [[ "$flags" != *d* ]] || return 1
  cs__normalize "$word" || return 1
  [[ "$CS_PATH" != / ]] || return 1
  last=${CS_PATH##*/}; parent=${CS_PATH%/*}
  [[ -n "$parent" ]] || parent=/
  if [[ "$flags" == *g* ]]; then
    [[ "$parent" != *[*?[]* && "$last" != .* ]] || return 1
  fi
  # "rm -r link/" acts on the link target, which may be anywhere.
  if [[ "$word" == */ && -L "$CS_PATH" ]]; then return 1; fi
  cs__physical_dir "$parent" || return 1
  CS_REAL=${CS_PHYS%/}/$last
}

cs__add_root() {
  local physical
  physical=$(cd -P -- "$1" 2>/dev/null && pwd -P) || return 0
  case "$physical" in
    /|/tmp|/var/tmp|/private/tmp|/private/var/tmp|/home|/Users|"$HOME") return 0 ;;
  esac
  [[ "$physical" != "$(cd -P -- "$HOME" 2>/dev/null && pwd -P)" ]] || return 0
  CS_ROOTS+=("$physical")
}

# Disposable roots: this Claude Code session's own temporary directory
# (<tmp>/claude-<uid>/<project>/<session_id>) plus any directory listed in
# CLAUDE_HOOK_DISPOSABLE_ROOTS (colon-separated absolute paths).
cs__init_roots() {
  local base dir uid
  local -a extra=()
  [[ "$CS__ROOTS_DONE" == false ]] || return 0
  CS__ROOTS_DONE=true; CS_ROOTS=()
  if [[ -n "$CS_SID" ]]; then
    uid=$(id -u)
    for base in "/tmp/claude-$uid" "${TMPDIR:-/tmp}/claude-$uid"; do
      base=${base//\/\//\/}
      [[ -d "$base" && -O "$base" ]] || continue
      for dir in "$base"/*/"$CS_SID"; do
        [[ -d "$dir" && ! -L "$dir" && -O "$dir" ]] && cs__add_root "$dir"
      done
    done
  fi
  IFS=: read -ra extra <<< "${CLAUDE_HOOK_DISPOSABLE_ROOTS:-}"
  for dir in ${extra[@]+"${extra[@]}"}; do
    [[ "$dir" == /* && -d "$dir" ]] && cs__add_root "$dir"
  done
  return 0
}

# cs_path_disposable WORD FLAGS [equal]: true when the path is inside a
# disposable root. With "equal", the root itself is accepted too.
cs_path_disposable() {
  local root
  cs__real_path "$1" "$2" || return 1
  cs__init_roots
  (( ${#CS_ROOTS[@]} > 0 )) || return 1
  for root in "${CS_ROOTS[@]}"; do
    [[ "$CS_REAL" == "$root"/* ]] && return 0
    [[ "${3:-}" == equal && "$CS_REAL" == "$root" ]] && return 0
  done
  return 1
}

cs__repo_top() {
  local top
  if [[ "$CS__TOP_DONE" == false ]]; then
    CS__TOP_DONE=true; CS_TOP=""
    if [[ "$CS_CWD_OK" == true ]]; then
      top=$(git -c core.fsmonitor=false -C "$CS_CWD" rev-parse --show-toplevel 2>/dev/null) || top=""
      [[ -n "$top" ]] && top=$(cd -P -- "$top" 2>/dev/null && pwd -P) || top=""
      case "$top" in
        ''|/|"$HOME") top="" ;;
      esac
      [[ -z "$top" || "$top" != "$(cd -P -- "$HOME" 2>/dev/null && pwd -P)" ]] || top=""
      CS_TOP=$top
    fi
  fi
  [[ -n "$CS_TOP" ]]
}

# cs_path_in_repo WORD FLAGS [equal]: true when the path is inside the Git
# work tree of the working directory.
cs_path_in_repo() {
  cs__real_path "$1" "$2" || return 1
  cs__repo_top || return 1
  [[ "$CS_REAL" == "$CS_TOP"/* ]] && return 0
  [[ "${3:-}" == equal && "$CS_REAL" == "$CS_TOP" ]]
}

cs_artifact_name() {
  [[ "$1" =~ ^($CS_ARTIFACT_NAMES)$ || "$1" == *.egg-info || "$1" == \*.pyc || "$1" == \*.pyo ]]
}

# cs_path_artifact WORD FLAGS: true for a regenerable build or cache path in
# the current Git work tree that Git ignores.
cs_path_artifact() {
  local rel part found=false
  local -a parts=()
  cs_path_in_repo "$1" "$2" || return 1
  rel=${CS_REAL#"$CS_TOP"/}
  IFS=/ read -ra parts <<< "$rel"
  for part in ${parts[@]+"${parts[@]}"}; do
    cs_artifact_name "$part" && found=true
  done
  [[ "$rel" == *.pyc || "$rel" == *.pyo ]] && found=true
  [[ "$found" == true ]] || return 1
  # Git does not report a path as ignored while it holds tracked files.
  git -c core.fsmonitor=false -C "$CS_TOP" check-ignore -q -- "$rel" 2>/dev/null
}

# cs_rm_safe SEGMENT: rm or rmdir at CS_I. Plain removal of literal paths is
# not gated; recursive, forced or globbed removal passes only for disposable
# or ignored build paths.
cs_rm_safe() {
  local seg=$1 j end w f risky=false options=true
  local -a operands=()
  end=${CS_END[seg]}
  for ((j = CS_I + 1; j < end; j++)); do
    w=${CS_WORDS[j]}; f=${CS_FLAGS[j]}
    if [[ "$options" == true && "$w" == -- ]]; then options=false; continue; fi
    if [[ "$options" == true && "$w" == -?* ]]; then
      case "$w" in
        --recursive|--force) risky=true ;;
        --*) ;;
        *[rRf]*) risky=true ;;
      esac
      [[ "$f" != *[dg]* ]] || risky=true
      continue
    fi
    operands+=("$j")
    [[ "$f" != *g* ]] || risky=true
  done
  [[ "$risky" == true ]] || return 0
  (( ${#operands[@]} > 0 )) || return 1
  [[ "$CS_VIA" != exec && "$CS_PRIV" == false ]] || return 1
  for j in "${operands[@]}"; do
    cs_path_disposable "${CS_WORDS[j]}" "${CS_FLAGS[j]}" \
      || cs_path_artifact "${CS_WORDS[j]}" "${CS_FLAGS[j]}" || return 1
  done
}

# cs_find_safe SEGMENT: find at CS_I. Sets CS_REASON when it is not safe.
cs_find_safe() {
  local seg=$1 j end w delete=false has_name=false plain=true mindepth=0
  local -a starts=() start_flags=()
  end=${CS_END[seg]}
  j=$((CS_I + 1))
  while (( j < end )) && [[ "${CS_WORDS[j]}" != -* && ! "${CS_WORDS[j]}" =~ ^(\(|\)|!|,)$ ]]; do
    starts+=("${CS_WORDS[j]}"); start_flags+=("${CS_FLAGS[j]}"); j=$((j + 1))
  done
  for ((; j < end; j++)); do
    w=${CS_WORDS[j]}
    case "$w" in
      -delete) delete=true ;;
      -exec|-execdir|-ok|-okdir)
        if (( j + 1 < end )) && [[ "${CS_WORDS[j+1]##*/}" =~ ^(rm|rmdir|unlink|shred)$ ]]; then
          CS_REASON="find runs a removal command; confirm the target and scope."
          return 1
        fi
        plain=false
        ;;
      -name|-iname)
        j=$((j + 1)); has_name=true
        ;;
      -type|-maxdepth) j=$((j + 1)) ;;
      -mindepth) j=$((j + 1)); [[ "${CS_WORDS[j]:-0}" =~ ^[0-9]+$ ]] && mindepth=${CS_WORDS[j]} ;;
      -print|-empty|-depth) ;;
      *) plain=false ;;
    esac
  done
  [[ "$delete" == true ]] || return 0
  CS_REASON="find -delete removes files; confirm the target and scope."
  [[ "$CS_VIA" != exec && "$CS_PRIV" == false ]] || return 1
  if (( ${#starts[@]} == 0 )); then starts=(.); start_flags=(""); fi
  local all_disposable=true k
  for k in "${!starts[@]}"; do
    if ! cs_path_disposable "${starts[k]}" "${start_flags[k]}"; then
      if [[ "$has_name" == true || "$mindepth" -ge 1 ]]; then
        cs_path_disposable "${starts[k]}" "${start_flags[k]}" equal || all_disposable=false
      else
        all_disposable=false
      fi
    fi
  done
  # A name predicate does not prove that actual matches are untracked or owned.
  # Only task-owned scratch is eligible for quiet find -delete.
  [[ "$all_disposable" == true && "$plain" == true ]]
}

# cs_sqlite_local SEGMENT: sqlite3 at CS_I works on an in-memory database or
# on a file inside a disposable root or the current Git work tree.
cs_sqlite_local() {
  local seg=$1 j end w db="" found=false
  end=${CS_END[seg]}
  [[ "$CS_VIA" != exec && "$CS_PRIV" == false ]] || return 1
  for ((j = CS_I + 1; j < end; j++)); do
    w=${CS_WORDS[j]}
    if [[ "$w" == -* ]]; then
      case "${w#-}" in
        -cmd|cmd|-init|init|-separator|separator|-newline|newline|-nullvalue|nullvalue|-escape|escape) j=$((j + 1)) ;;
        -*|batch|bail|header|noheader|csv|json|line|list|column|box|table|markdown|html|quote|tabs|ascii|readonly|echo|interactive|safe|nofollow|stats) ;;
        *) return 1 ;;
      esac
      continue
    fi
    db=$w; found=true
    [[ "${CS_FLAGS[j]}" != *[dg]* ]] || return 1
    break
  done
  [[ "$found" == false || "$db" == :memory: ]] && return 0
  cs_path_disposable "$db" "" || cs_path_in_repo "$db" ""
}

cs__pg_dbarg() {
  local value=$1 pair
  local -a pairs=()
  local uri='^postgres(ql)?://([A-Za-z0-9._-]+)(:([0-9]+))?/([A-Za-z0-9._-]+)$'
  if [[ "$value" =~ $uri ]]; then
    [[ -z "$cs__pg_host$cs__pg_port$cs__pg_db" ]] || return 1
    cs__pg_host=${BASH_REMATCH[2]}; cs__pg_port=${BASH_REMATCH[4]}; cs__pg_db=${BASH_REMATCH[5]}
    cs__pg_connection=true
  elif [[ "$value" == *=* ]]; then
    [[ -z "$cs__pg_host$cs__pg_port$cs__pg_db" ]] || return 1
    read -ra pairs <<< "$value"
    for pair in ${pairs[@]+"${pairs[@]}"}; do
      case "$pair" in
        host=*) [[ -z "$cs__pg_host" ]] || return 1; cs__pg_host=${pair#*=} ;;
        port=*) [[ -z "$cs__pg_port" ]] || return 1; cs__pg_port=${pair#*=} ;;
        dbname=*) [[ -z "$cs__pg_db" ]] || return 1; cs__pg_db=${pair#*=} ;;
        *) return 1 ;;
      esac
    done
    cs__pg_connection=true
  else
    [[ "$value" =~ ^[A-Za-z0-9._-]+$ && -z "$cs__pg_db" ]] || return 1
    cs__pg_db=$value
  fi
}

# cs_pg_dev_target SEGMENT: psql at CS_I connects to a host and database that
# are both explicit in the command and listed in the dev-target allowlist
# (${CLAUDE_HOOK_POSTGRES_DEV_TARGETS:-~/.config/claude-hooks/postgres-dev-targets}),
# one "host[:port]/dbname" per line. localhost alone is never trusted: a port
# forward to a production database also listens there.
cs_pg_dev_target() {
  local seg=$1 j end w f positional=0 file entry target
  cs__pg_host=""; cs__pg_port=""; cs__pg_db=""; cs__pg_connection=false
  [[ "$CS_VIA" == direct && "$CS_PRIV" == false ]] || return 1
  # libpq can route using these even when host/dbname are explicit. Do not
  # partially interpret services or hostaddr, including inherited defaults.
  [[ -z "${PGHOSTADDR:-}${PGSERVICE:-}${PGSERVICEFILE:-}" ]] || return 1
  end=${CS_END[seg]}
  for ((j = CS_START[seg]; j < CS_I; j++)); do
    w=${CS_WORDS[j]}
    [[ "$w" == PG*=* && "${CS_FLAGS[j]}" == *d* ]] && return 1
    case "$w" in
      PGHOST=*) cs__pg_host=${w#*=} ;;
      PGPORT=*) cs__pg_port=${w#*=} ;;
      PGDATABASE=*) cs__pg_db=${w#*=} ;;
      PGHOSTADDR=*|PGSERVICE=*|PGSERVICEFILE=*|PGPASSWORD=*) return 1 ;;
    esac
  done
  for ((j = CS_I + 1; j < end; j++)); do
    w=${CS_WORDS[j]}; f=${CS_FLAGS[j]}
    case "$w" in
      -h|--host|-p|--port|-d|--dbname)
        [[ "$cs__pg_connection" == false ]] || return 1
        j=$((j + 1))
        (( j < end )) && [[ "${CS_FLAGS[j]}" != *d* ]] || return 1
        case "$w" in
          -h|--host) [[ -z "$cs__pg_host" ]] || return 1; cs__pg_host=${CS_WORDS[j]} ;;
          -p|--port) [[ -z "$cs__pg_port" ]] || return 1; cs__pg_port=${CS_WORDS[j]} ;;
          *) cs__pg_dbarg "${CS_WORDS[j]}" || return 1 ;;
        esac
        ;;
      -c|--command|-f|--file|-U|--username|-v|--set|--variable|-o|--output|-L|--log-file|-F|--field-separator|-R|--record-separator|-P|--pset|-T|--table-attr) j=$((j + 1)) ;;
      --host=*|--port=*|--dbname=*|-h?*|-p?*|-d?*)
        [[ "$cs__pg_connection" == false ]] || return 1
        [[ "$f" != *d* ]] || return 1
        case "$w" in
          --host=*) [[ -z "$cs__pg_host" ]] || return 1; cs__pg_host=${w#*=} ;;
          --port=*) [[ -z "$cs__pg_port" ]] || return 1; cs__pg_port=${w#*=} ;;
          --dbname=*) cs__pg_dbarg "${w#*=}" || return 1 ;;
          -h*) [[ -z "$cs__pg_host" ]] || return 1; cs__pg_host=${w#-h} ;;
          -p*) [[ -z "$cs__pg_port" ]] || return 1; cs__pg_port=${w#-p} ;;
          -d*) cs__pg_dbarg "${w#-d}" || return 1 ;;
        esac
        ;;
      -*) ;;
      *)
        positional=$((positional + 1))
        if (( positional == 1 )); then
          [[ "$f" != *d* ]] || return 1
          cs__pg_dbarg "$w" || return 1
        fi
        ;;
    esac
  done
  [[ "$cs__pg_host" =~ ^[A-Za-z0-9._-]+$ && "$cs__pg_db" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  [[ -n "$cs__pg_port" || -z "${PGPORT:-}" ]] || return 1
  [[ -n "$cs__pg_port" ]] || cs__pg_port=5432
  [[ "$cs__pg_port" =~ ^[0-9]+$ ]] || return 1
  target=$(printf '%s' "$cs__pg_host" | tr '[:upper:]' '[:lower:]'):$cs__pg_port/$cs__pg_db
  file=${CLAUDE_HOOK_POSTGRES_DEV_TARGETS:-${XDG_CONFIG_HOME:-$HOME/.config}/claude-hooks/postgres-dev-targets}
  [[ -f "$file" ]] || return 1
  while IFS= read -r entry || [[ -n "$entry" ]]; do
    entry=${entry%%#*}
    entry=${entry//[[:space:]]/}
    [[ "$entry" == */* ]] || continue
    [[ "${entry%%/*}" == *:* ]] || entry="${entry%%/*}:5432/${entry#*/}"
    entry="$(printf '%s' "${entry%%/*}" | tr '[:upper:]' '[:lower:]')/${entry#*/}"
    [[ "$entry" == "$target" ]] && return 0
  done < "$file"
  return 1
}
