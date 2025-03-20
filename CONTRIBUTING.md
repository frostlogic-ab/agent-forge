# 🤝 Contributing to Agent Forge

Thank you for your interest in contributing to Agent Forge! This document provides guidelines and instructions for contributing.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Commit Message Guidelines](#commit-message-guidelines)
- [PR Labeling Guidelines](#pr-labeling-guidelines-for-semantic-versioning)
- [Development Environment](#development-environment)
- [Pull Request Process](#pull-request-process)
- [Style Guidelines](#style-guidelines)
- [Adding New Features](#adding-new-features)
- [License](#license)

---

## 📝 Code of Conduct

Please be respectful and considerate of others when contributing to this project.

---

## 🚀 How to Contribute

1. Fork the repository
2. Create a new branch for your feature: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Write tests for your changes
5. Run the tests: `yarn test`
6. Commit your changes using the conventional commit format (see below)
7. Push to the branch: `git push origin feature/your-feature-name`
8. Submit a pull request to the `beta` branch
9. Add appropriate labels to your PR for semantic versioning (see PR Labeling Guidelines)

---

## 💬 Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages. This leads to more readable messages that are easy to follow when looking through the project history.

Each commit message consists of a **header**, a **body**, and a **footer**:

```
<type>(<scope>): <subject>
<BLANK LINE>
<body>
<BLANK LINE>
<footer>
```

The **header** is mandatory and the **scope** is optional.

### Type

Must be one of the following:

| Type         | Description                                                                       |
| ------------ | --------------------------------------------------------------------------------- |
| **feat**     | A new feature                                                                     |
| **fix**      | A bug fix                                                                         |
| **docs**     | Documentation only changes                                                        |
| **style**    | Changes that do not affect the meaning of the code (white-space, formatting, etc) |
| **refactor** | A code change that neither fixes a bug nor adds a feature                         |
| **perf**     | A code change that improves performance                                           |
| **test**     | Adding missing tests or correcting existing tests                                 |
| **build**    | Changes that affect the build system or external dependencies                     |
| **ci**       | Changes to our CI configuration files and scripts                                 |
| **chore**    | Other changes that don't modify src or test files                                 |

### Examples

```
feat(agent): add ability to process multimodal inputs

fix(llm): resolve token counting issue with non-ASCII characters

docs: update README with new installation instructions
```

---

## 🏷️ PR Labeling Guidelines for Semantic Versioning

Our project uses PR labels to determine the semantic version for releases. When creating a PR, please add one of the following labels based on the type of changes included:

| Label                          | Usage                                     | Version Impact     |
| ------------------------------ | ----------------------------------------- | ------------------ |
| **breaking**                   | Changes that break backward compatibility | MAJOR version bump |
| **feature** or **enhancement** | New features or significant improvements  | MINOR version bump |
| **fix** or **bug**             | Bug fixes                                 | PATCH version bump |
| **documentation**              | Documentation changes                     | PATCH version bump |

The label with the highest precedence (breaking > feature/enhancement > fix/bug/documentation) will determine the version bump.

---

## 💻 Development Environment

1. Clone the repository

   ```bash
   git clone https://github.com/your-username/agent-forge.git
   cd agent-forge
   ```

2. Install dependencies

   ```bash
   yarn install
   ```

3. Build the project

   ```bash
   yarn build
   ```

4. Run tests
   ```bash
   yarn test
   ```

---

## 🔄 Pull Request Process

1. Update the README.md with details of changes if necessary
2. Update any examples or documentation
3. The PR should work with the existing tests
4. Ensure your code follows the project's style guidelines
5. Add appropriate semantic versioning labels to your PR

---

## 📐 Style Guidelines

- Use TypeScript for all code
- Follow the existing code style
- Write meaningful commit messages
- Document public functions and classes

---

## ✨ Adding New Features

- For major changes, please open an issue first to discuss the proposed change
- Add tests for any new features

---

## 📄 License

By contributing to Agent Forge, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
