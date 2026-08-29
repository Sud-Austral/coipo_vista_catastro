#!/usr/bin/env python3

import argparse
import subprocess
from pathlib import Path


SYSTEM_PROMPT = """
You are a documentation editor.

Your task is to maintain a repository README.

You must use ONLY the information provided in the repository context.

Rules:

1. Never invent functionality.
2. Never invent commands.
3. Never invent environment variables.
4. Never invent API endpoints.
5. Never invent installation instructions.
6. Never invent dependencies.
7. Do not remove useful documentation.
8. Preserve the existing README structure.
9. Preserve the language of the README.
10. Make the smallest possible changes.
11. Do not rewrite the entire README unnecessarily.
12. Do not modify anything except README.md.
13. If the README is already accurate, return exactly:

NO_UPDATE

Otherwise return the COMPLETE new README.md.

Do not explain your reasoning.
Do not use Markdown fences around the README.
"""


def run_model(llama, model, prompt):
    command = [
        llama,
        "-m",
        model,
        "-c",
        "8192",
        "-n",
        "4096",
        "--temp",
        "0.1",
        "--top-p",
        "0.9",
        "-p",
        prompt,
    ]

    result = subprocess.run(
        command,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=600,
        check=False,
    )

    if result.returncode != 0:
        print(result.stderr)
        raise RuntimeError(
            f"El modelo terminó con código {result.returncode}"
        )

    return result.stdout.strip()


def clean_response(response):
    response = response.strip()

    if response.startswith("```"):
        lines = response.splitlines()

        if lines and lines[0].startswith("```"):
            lines = lines[1:]

        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]

        response = "\n".join(lines).strip()

    return response


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument("--llama", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--readme", required=True)
    parser.add_argument("--diff", required=True)
    parser.add_argument("--changed-files", required=True)

    args = parser.parse_args()

    readme_path = Path(args.readme)

    if not readme_path.exists():
        print("No existe README.md. No se realizará ninguna modificación.")
        return

    readme = readme_path.read_text(
        encoding="utf-8",
        errors="replace",
    )

    diff = Path(args.diff).read_text(
        encoding="utf-8",
        errors="replace",
    )

    changed_files = Path(args.changed_files).read_text(
        encoding="utf-8",
        errors="replace",
    )

    prompt = f"""
{SYSTEM_PROMPT}

REPOSITORY CHANGE

Changed files:

{changed_files}

Latest changes:

{diff}

CURRENT README

{readme}

TASK

Determine whether the latest repository changes require an update to README.md.

If the current README remains accurate, return exactly:

NO_UPDATE

If an update is necessary, return the complete updated README.md.
"""

    print("Ejecutando modelo local...")

    response = run_model(
        args.llama,
        args.model,
        prompt,
    )

    response = clean_response(response)

    if response == "NO_UPDATE":
        print("El modelo determinó que no se necesita actualizar README.")
        return

    if len(response) < 100:
        raise RuntimeError(
            "La respuesta del modelo es demasiado corta; "
            "se rechaza para evitar destruir README.md."
        )

    # Protección adicional:
    # nunca aceptar respuestas que parezcan ser una explicación
    # en vez del README completo.
    if "NO_UPDATE" in response[:100]:
        raise RuntimeError(
            "Respuesta ambigua del modelo. README no será modificado."
        )

    # El README generado debe conservar contenido Markdown.
    if not any(
        marker in response
        for marker in ["#", "##", "###", "-", "*"]
    ):
        raise RuntimeError(
            "La respuesta no parece ser un README Markdown válido."
        )

    original = readme

    if response.strip() == original.strip():
        print("El modelo devolvió el mismo README.")
        return

    readme_path.write_text(
        response.rstrip() + "\n",
        encoding="utf-8",
    )

    print("README.md actualizado por el modelo.")

    print("\n=== DIFF GENERADO ===")

    diff_result = subprocess.run(
        ["git", "diff", "--", "README.md"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    print(diff_result.stdout)


if __name__ == "__main__":
    main()