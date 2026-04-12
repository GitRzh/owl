from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os, warnings

warnings.filterwarnings("ignore", category=DeprecationWarning)

DOCS_DIR       = os.path.join(os.path.dirname(__file__), "docs")
EMBEDDINGS_DIR = os.path.join(os.path.dirname(__file__), "embeddings")

# BUG-I fix: langchain_community.vectorstores.Chroma is removed in newer
# langchain releases (>=0.2).  Prefer the dedicated langchain-chroma package
# and fall back to the community shim only if the new package is absent.
try:
    from langchain_chroma import Chroma
except ImportError:
    from langchain_community.vectorstores import Chroma  # legacy fallback

# Use updated import — falls back to community if huggingface pkg not installed
try:
    from langchain_huggingface import HuggingFaceEmbeddings
except ImportError:
    from langchain_community.embeddings import HuggingFaceEmbeddings

embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
vectorstore = None

def init_rag():
    global vectorstore
    if os.path.exists(EMBEDDINGS_DIR) and os.listdir(EMBEDDINGS_DIR):
        print("Loading existing embeddings...")
        vectorstore = Chroma(
            persist_directory=EMBEDDINGS_DIR,
            embedding_function=embeddings
        )
        return

    print("Building embeddings from docs/ — first time only...")
    splitter   = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=80)
    all_chunks = []

    pdf_files = [f for f in os.listdir(DOCS_DIR) if f.endswith(".pdf")]
    if not pdf_files:
        print("WARNING: No PDFs in docs/ — RAG inactive.")
        return

    for filename in pdf_files:
        path = os.path.join(DOCS_DIR, filename)
        try:
            chunks = splitter.split_documents(PyPDFLoader(path).load())
            all_chunks.extend(chunks)
            print(f"  Loaded: {filename} ({len(chunks)} chunks)")
        except Exception as e:
            print(f"  Failed: {filename} — {e}")

    if not all_chunks:
        print("WARNING: No content extracted.")
        return

    vectorstore = Chroma.from_documents(
        documents=all_chunks,
        embedding=embeddings,
        persist_directory=EMBEDDINGS_DIR
    )
    print(f"RAG ready. {len(all_chunks)} chunks indexed.")

def retrieve_context(query: str, k: int = 2) -> str:
    if vectorstore is None:
        return ""
    try:
        results = vectorstore.similarity_search(query, k=k)
        return "\n\n".join([doc.page_content for doc in results])
    except Exception:
        return ""