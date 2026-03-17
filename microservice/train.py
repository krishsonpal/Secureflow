import pandas as pd
import joblib
import os

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

# Create models folder
os.makedirs("models", exist_ok=True)

df = pd.read_csv(r"MLMicroservice\XSS_dataset.csv")  


df = df[['Sentence', 'Label']]

X_text = df['Sentence']
y = df['Label'].values


vectorizer = TfidfVectorizer(
    ngram_range=(1, 2),
    max_features=5000
)

X = vectorizer.fit_transform(X_text)


X_attack = X[y == 1]
X_normal = X[y == 0]

centroid_attack = np.asarray(X_attack.mean(axis=0))
centroid_normal = np.asarray(X_normal.mean(axis=0))


rf = RandomForestClassifier(
    n_estimators=100,
    max_depth=15,
    n_jobs=-1,
    random_state=42
)

rf.fit(X, y)


joblib.dump(vectorizer, "models/vectorizer.pkl")
joblib.dump(rf, "models/rf.pkl")
joblib.dump(centroid_attack, "models/centroid_attack.pkl")
joblib.dump(centroid_normal, "models/centroid_normal.pkl")

print("Training complete and models saved.")
